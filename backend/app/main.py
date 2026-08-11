from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from typing import Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .engines.inpainting import cuda_available, device_name

app = FastAPI(title="AI Video Cleaner Worker", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = os.getenv("CLEANER_STORAGE", "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

WORKER_SECRET = os.getenv("CLEANER_WORKER_SECRET", "default_secret")
USE_CELERY = os.getenv("USE_CELERY", "0") == "1"

# estado em memória (o estado autoritativo vive no app Lovable via callback)
JOBS: Dict[str, dict] = {}


def verify_token(job_id: str, token: Optional[str]) -> None:
    """Aceita HMAC simples do job_id ou o formato `job.exp.sig` do app."""
    if not token:
        raise HTTPException(401, "missing job token")
    simple = hmac.new(WORKER_SECRET.encode(), job_id.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(token, simple):
        return
    parts = token.split(".")
    if len(parts) == 3 and parts[0] == job_id:
        payload = f"{parts[0]}.{parts[1]}"
        expected = hmac.new(WORKER_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, parts[2]):
            return
    raise HTTPException(401, "invalid job token")


class DetectRequest(BaseModel):
    mode: str = "subtitle"
    roi: Optional[dict] = None


class ProcessRequest(BaseModel):
    jobId: Optional[str] = None
    mode: str = "subtitle"
    preset: str = "quality"
    masks: List[dict] = []
    options: dict = {}
    callbackUrl: Optional[str] = None


@app.get("/v1/health")
async def health():
    return {
        "online": True,
        "cuda": cuda_available(),
        "gpu": device_name(),
        "engines": ["propainter", "sttn", "lama", "temporal-fill"],
        "version": app.version,
    }


@app.post("/v1/jobs/{job_id}/upload")
async def upload_video(job_id: str, file: UploadFile = File(...),
                       x_job_token: str = Header(None)):
    verify_token(job_id, x_job_token)
    job_dir = os.path.join(STORAGE_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    path = os.path.join(job_dir, "input.mp4")
    with open(path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            buffer.write(chunk)
    JOBS[job_id] = {"status": "uploaded", "progress": 0, "stage": "enviado"}
    return {"ok": True, "filename": file.filename, "size": os.path.getsize(path)}


@app.post("/v1/jobs/{job_id}/detect")
async def detect(job_id: str, req: DetectRequest, x_job_token: str = Header(None)):
    verify_token(job_id, x_job_token)
    from .workers.tasks import auto_detect

    regions = auto_detect(job_id, req.mode)
    JOBS.setdefault(job_id, {}).update({"status": "detecting", "detections": regions})
    return {"regions": regions}


@app.post("/v1/jobs/{job_id}/process")
async def start_process(job_id: str, req: ProcessRequest, background_tasks: BackgroundTasks,
                        x_job_token: str = Header(None)):
    verify_token(job_id, x_job_token)
    JOBS[job_id] = {"status": "queued", "progress": 0, "stage": "na fila"}

    if USE_CELERY:
        from .workers.tasks import process_video_task

        task = process_video_task.delay(job_id, req.mode, req.preset, req.masks, req.callbackUrl)
        return {"status": "queued", "job_id": job_id, "task_id": task.id}

    from .workers.tasks import run_pipeline

    def progress_cb(progress: float, stage: str) -> None:
        JOBS[job_id] = {"status": "processing", "progress": progress, "stage": stage}

    def run() -> None:
        try:
            result = run_pipeline(job_id, req.mode, req.preset, req.masks,
                                  req.callbackUrl, progress_cb)
            JOBS[job_id] = result
        except Exception as exc:
            JOBS[job_id] = {"status": "failed", "progress": 0, "error": str(exc)}

    background_tasks.add_task(run)
    return {"status": "queued", "job_id": job_id}


@app.get("/v1/jobs/{job_id}")
async def job_status(job_id: str, x_job_token: str = Header(None)):
    verify_token(job_id, x_job_token)
    return JOBS.get(job_id, {"status": "unknown", "progress": 0})


@app.post("/v1/jobs/{job_id}/cancel")
async def cancel(job_id: str, x_job_token: str = Header(None)):
    verify_token(job_id, x_job_token)
    JOBS[job_id] = {"status": "failed", "error": "cancelado", "progress": 0}
    return {"ok": True}


@app.get("/v1/jobs/{job_id}/result")
async def get_result(job_id: str):
    path = os.path.join(STORAGE_DIR, job_id, "output.mp4")
    if not os.path.exists(path):
        raise HTTPException(404, "resultado ainda não disponível")
    return FileResponse(path, media_type="video/mp4", filename=f"{job_id}-limpo.mp4")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
