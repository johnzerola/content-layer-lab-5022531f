from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from contextlib import asynccontextmanager
import hashlib
import os
from pathlib import Path
import shutil
import threading
import time
from typing import Deque, Dict, List, Literal, Optional
from urllib.parse import unquote

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .config import get_settings
from .engines.diffueraser_official import diffueraser_status
from .engines.inpainting import cuda_available, device_name
from .engines.propainter_official import propainter_status
from .security import TokenError, validate_callback_url, validate_job_token, validate_service_token
from .services.media_resolver import MediaResolveError, resolve_public_media
from .services.text_detect import detector_status
from .storage import cleanup_expired, directory_size, job_dir, read_state, write_state
from .utils.video import probe


SETTINGS = get_settings()
SETTINGS.storage_dir.mkdir(parents=True, exist_ok=True)
JOBS: Dict[str, dict] = {}
ACTIVE_JOBS: set[str] = set()
ACTIVE_LOCK = threading.Lock()
RATE_BUCKETS: Dict[str, Deque[float]] = defaultdict(deque)
MAX_RATE_BUCKETS = 10_000
VIDEO_TYPES = {
    "application/octet-stream",
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-matroska",
    "video/x-msvideo",
}
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        await asyncio.to_thread(cleanup_expired, SETTINGS.storage_dir, SETTINGS.retention_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    cleanup_expired(SETTINGS.storage_dir, SETTINGS.retention_seconds)
    task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="AI Video Cleaner Worker",
    version="2.1.0",
    docs_url=None if SETTINGS.production else "/docs",
    redoc_url=None if SETTINGS.production else "/redoc",
    openapi_url=None if SETTINGS.production else "/openapi.json",
    lifespan=lifespan,
)

if SETTINGS.allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(SETTINGS.allowed_hosts))
if SETTINGS.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(SETTINGS.cors_origins),
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["content-type", "x-file-size", "x-job-token"],
        max_age=600,
    )


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and request.client and request.client.host in {"127.0.0.1", "::1"}:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    now = time.monotonic()
    client_key = _client_key(request)
    if client_key not in RATE_BUCKETS and len(RATE_BUCKETS) >= MAX_RATE_BUCKETS:
        RATE_BUCKETS.pop(next(iter(RATE_BUCKETS)))
    bucket = RATE_BUCKETS[client_key]
    while bucket and bucket[0] <= now - 60:
        bucket.popleft()
    limit = SETTINGS.rate_limit_per_minute
    if len(bucket) >= limit:
        return JSONResponse({"detail": "rate limit exceeded"}, status_code=429, headers={"Retry-After": "60"})
    bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path != "/v1/health":
        response.headers["Cache-Control"] = "no-store"
    return response


def verify_token(job_id: str, token: Optional[str], *scopes: str) -> str:
    try:
        return validate_job_token(SETTINGS.worker_secret, job_id, token, scopes)
    except (TokenError, ValueError):
        raise HTTPException(401, "invalid or expired job token") from None


def _set_state(job_id: str, patch: dict) -> dict:
    directory = job_dir(SETTINGS.storage_dir, job_id)
    state = {**read_state(directory), **JOBS.get(job_id, {}), **patch}
    JOBS[job_id] = state
    write_state(directory, state)
    return state


def _positive_header(value: Optional[str]) -> int:
    if not value:
        return 0
    try:
        parsed = int(value)
    except ValueError:
        raise HTTPException(400, "invalid content length") from None
    return max(0, parsed)


def _validate_video(path: Path) -> dict:
    try:
        info = probe(str(path))
    except Exception as exc:
        raise HTTPException(415, "arquivo nao e um video valido") from exc
    if info.duration <= 0 or info.duration > SETTINGS.max_duration_seconds:
        raise HTTPException(413, f"duracao maxima: {int(SETTINGS.max_duration_seconds)} segundos")
    if info.width > SETTINGS.max_width or info.height > SETTINGS.max_height:
        raise HTTPException(413, f"resolucao maxima: {SETTINGS.max_width}x{SETTINGS.max_height}")
    if info.fps > SETTINGS.max_fps:
        raise HTTPException(413, f"FPS maximo: {SETTINGS.max_fps:g}")
    return {
        "width": info.width,
        "height": info.height,
        "fps": round(info.fps, 3),
        "duration": round(info.duration, 3),
        "frames": info.frames,
        "has_audio": info.has_audio,
    }


class DetectRequest(BaseModel):
    mode: Literal["smart", "subtitle", "text", "watermark", "logo", "object", "passerby"] = "subtitle"
    roi: Optional[dict] = None


class ProcessRequest(BaseModel):
    jobId: Optional[str] = None
    mode: Literal["smart", "subtitle", "text", "watermark", "logo", "object", "passerby"] = "subtitle"
    preset: Literal["fast", "quality", "max"] = "quality"
    masks: List[dict] = Field(default_factory=list, max_length=500)
    options: dict = Field(default_factory=dict)
    callbackUrl: Optional[str] = None


class MediaResolveRequest(BaseModel):
    url: str = Field(min_length=10, max_length=2048)


@app.get("/v1/health")
async def health():
    propainter = propainter_status()
    diffueraser = diffueraser_status()
    disk = shutil.disk_usage(SETTINGS.storage_dir)
    return {
        "online": True,
        "ai_ready": propainter.ready,
        "max_ready": diffueraser.ready,
        "cuda": cuda_available(),
        "gpu": device_name(),
        "engines": {
            "propainter": {"ready": propainter.ready, "missing": list(propainter.missing)},
            "diffueraser": {"ready": diffueraser.ready, "missing": list(diffueraser.missing)},
            "temporal_fill": {"ready": True, "quality": "fallback"},
        },
        "detectors": {"text": detector_status()},
        "limits": {
            "max_upload_bytes": SETTINGS.max_upload_bytes,
            "max_duration_seconds": SETTINGS.max_duration_seconds,
            "max_resolution": [SETTINGS.max_width, SETTINGS.max_height],
            "max_fps": SETTINGS.max_fps,
            "retention_hours": SETTINGS.retention_seconds // 3600,
            "storage_free_bytes": disk.free,
        },
        "version": app.version,
    }


@app.post("/v1/media/resolve")
async def resolve_media(
    req: MediaResolveRequest, x_service_token: Optional[str] = Header(None)
):
    try:
        validate_service_token(SETTINGS.worker_secret, x_service_token, {"media"})
        return await asyncio.wait_for(
            asyncio.to_thread(
                resolve_public_media,
                req.url,
                SETTINGS.max_upload_bytes,
                SETTINGS.max_duration_seconds,
            ),
            timeout=45,
        )
    except TokenError:
        raise HTTPException(401, "invalid or expired service token") from None
    except asyncio.TimeoutError:
        raise HTTPException(504, "a plataforma demorou demais para responder") from None
    except MediaResolveError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post("/v1/jobs/{job_id}/upload")
async def upload_video(
    request: Request,
    job_id: str,
    file: Optional[UploadFile] = File(None),
    x_job_token: Optional[str] = Header(None),
    x_file_size: Optional[int] = Header(None),
    x_file_name: Optional[str] = Header(None),
):
    verify_token(job_id, x_job_token, "upload")
    if x_file_size is not None and (x_file_size < 1 or x_file_size > SETTINGS.max_upload_bytes):
        raise HTTPException(413, "arquivo excede o limite configurado")
    content_length = _positive_header(request.headers.get("content-length"))
    if content_length > SETTINGS.max_upload_bytes + 2 * 1024 * 1024:
        raise HTTPException(413, "arquivo excede o limite configurado")
    raw_upload = file is None
    filename = unquote((x_file_name or "video.mp4")[:500]) if raw_upload else (file.filename or "")
    suffix = Path(filename).suffix.lower()
    content_type = (
        request.headers.get("content-type", "application/octet-stream")
        if raw_upload
        else (file.content_type or "application/octet-stream")
    ).split(";", 1)[0].lower()
    if suffix not in VIDEO_SUFFIXES or content_type not in VIDEO_TYPES:
        raise HTTPException(415, "formato de video nao permitido")

    cleanup_expired(SETTINGS.storage_dir, SETTINGS.retention_seconds)
    existing = directory_size(SETTINGS.storage_dir)
    disk = shutil.disk_usage(SETTINGS.storage_dir)
    expected = x_file_size or SETTINGS.max_upload_bytes
    if existing + expected > SETTINGS.storage_quota_bytes or disk.free - expected < SETTINGS.min_free_bytes:
        raise HTTPException(507, "quota de armazenamento indisponivel")

    directory = job_dir(SETTINGS.storage_dir, job_id)
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "input.mp4").is_file():
        raise HTTPException(409, "upload ja concluido para este trabalho")
    temporary = directory / ".input.upload"
    destination = directory / "input.mp4"
    digest = hashlib.sha256()
    size = 0
    try:
        with temporary.open("wb") as buffer:
            if raw_upload:
                chunks = request.stream()
            else:
                async def multipart_chunks():
                    while chunk := await file.read(1024 * 1024):
                        yield chunk

                chunks = multipart_chunks()
            async for chunk in chunks:
                size += len(chunk)
                if size > SETTINGS.max_upload_bytes:
                    raise HTTPException(413, "arquivo excede o limite configurado")
                digest.update(chunk)
                buffer.write(chunk)
        if size == 0:
            raise HTTPException(400, "arquivo vazio")
        metadata = _validate_video(temporary)
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        if file is not None:
            await file.close()

    state = _set_state(job_id, {
        "status": "uploaded",
        "progress": 0,
        "stage": "enviado",
        "file_id": digest.hexdigest(),
        "size": size,
        "probe": metadata,
    })
    return {"ok": True, "file_id": state["file_id"], "size": size, "probe": metadata}


@app.get("/v1/jobs/{job_id}/input")
async def input_status(job_id: str, x_job_token: Optional[str] = Header(None)):
    verify_token(job_id, x_job_token, "control")
    directory = job_dir(SETTINGS.storage_dir, job_id)
    input_path = directory / "input.mp4"
    state = {**read_state(directory), **JOBS.get(job_id, {})}
    exists = input_path.is_file()
    return {
        "exists": exists,
        "size": input_path.stat().st_size if exists else 0,
        "probe": state.get("probe"),
        "file_id": state.get("file_id"),
    }


@app.post("/v1/jobs/{job_id}/detect")
async def detect(job_id: str, req: DetectRequest, x_job_token: Optional[str] = Header(None)):
    verify_token(job_id, x_job_token, "control")
    if not (job_dir(SETTINGS.storage_dir, job_id) / "input.mp4").is_file():
        raise HTTPException(409, "video ainda nao foi enviado")
    from .workers.tasks import auto_detect

    try:
        regions = auto_detect(job_id, req.mode)
    except Exception as exc:
        raise HTTPException(422, f"falha ao detectar areas: {str(exc)[:300]}") from None
    _set_state(job_id, {"status": "uploaded", "detections": regions})
    return {"regions": regions}


@app.post("/v1/jobs/{job_id}/process")
async def start_process(
    job_id: str,
    req: ProcessRequest,
    background_tasks: BackgroundTasks,
    x_job_token: Optional[str] = Header(None),
):
    verify_token(job_id, x_job_token, "control")
    if req.jobId and req.jobId != job_id:
        raise HTTPException(400, "jobId does not match path")
    try:
        callback_url = validate_callback_url(req.callbackUrl, SETTINGS.callback_origins)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    if not (job_dir(SETTINGS.storage_dir, job_id) / "input.mp4").is_file():
        raise HTTPException(409, "video ainda nao foi enviado")
    with ACTIVE_LOCK:
        if job_id in ACTIVE_JOBS:
            raise HTTPException(409, "job ja esta em processamento")
        if len(ACTIVE_JOBS) >= SETTINGS.max_concurrent_jobs:
            raise HTTPException(429, "capacidade de processamento ocupada; tente novamente")
        ACTIVE_JOBS.add(job_id)
    _set_state(job_id, {"status": "queued", "progress": 0, "stage": "na fila"})

    if SETTINGS.use_celery:
        from .workers.tasks import process_video_task

        task = process_video_task.delay(job_id, req.mode, req.preset, req.masks, callback_url, req.options)
        with ACTIVE_LOCK:
            ACTIVE_JOBS.discard(job_id)
        return {"status": "queued", "job_id": job_id, "task_id": task.id}

    from .workers.tasks import run_pipeline

    def progress_cb(progress: float, stage: str) -> None:
        _set_state(job_id, {"status": "processing", "progress": progress, "stage": stage})

    def run() -> None:
        try:
            result = run_pipeline(job_id, req.mode, req.preset, req.masks, callback_url, progress_cb, req.options)
            _set_state(job_id, result)
        except Exception as exc:
            _set_state(job_id, {"status": "failed", "progress": 0, "error": str(exc)[:1000]})
        finally:
            with ACTIVE_LOCK:
                ACTIVE_JOBS.discard(job_id)

    background_tasks.add_task(run)
    return {"status": "queued", "job_id": job_id}


@app.get("/v1/jobs/{job_id}")
async def job_status(job_id: str, x_job_token: Optional[str] = Header(None)):
    verify_token(job_id, x_job_token, "control")
    directory = job_dir(SETTINGS.storage_dir, job_id)
    state = {**read_state(directory), **JOBS.get(job_id, {})}
    return state or {"status": "unknown", "progress": 0}


@app.post("/v1/jobs/{job_id}/cancel")
async def cancel(job_id: str, x_job_token: Optional[str] = Header(None)):
    verify_token(job_id, x_job_token, "control")
    directory = job_dir(SETTINGS.storage_dir, job_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / ".cancel").touch()
    _set_state(job_id, {"status": "failed", "error": "cancelado", "progress": 0})
    return {"ok": True}


@app.delete("/v1/jobs/{job_id}")
async def delete_job(job_id: str, x_job_token: Optional[str] = Header(None)):
    verify_token(job_id, x_job_token, "control")
    directory = job_dir(SETTINGS.storage_dir, job_id)
    with ACTIVE_LOCK:
        if job_id in ACTIVE_JOBS:
            raise HTTPException(409, "cancele o processamento antes de excluir")
        JOBS.pop(job_id, None)
    await asyncio.to_thread(shutil.rmtree, directory, True)
    return {"ok": True}


@app.get("/v1/jobs/{job_id}/result")
async def get_result(job_id: str, background_tasks: BackgroundTasks, token: Optional[str] = Query(None)):
    verify_token(job_id, token, "result")
    directory = job_dir(SETTINGS.storage_dir, job_id)
    path = directory / "output.mp4"
    if not path.is_file():
        raise HTTPException(404, "resultado ainda nao disponivel")
    background_tasks.add_task(shutil.rmtree, directory, True)
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Content-Disposition": f'inline; filename="{job_id}-limpo.mp4"'},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
