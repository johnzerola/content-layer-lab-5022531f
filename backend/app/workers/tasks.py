"""Pipeline assíncrona completa (Celery, com fallback para execução inline).

video → scene detection → text detection → mask generation → refinement
      → temporal tracking → inpainting → validação temporal → encoding
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import time
from typing import Dict, List, Optional

import cv2
import numpy as np
import requests
from celery import Celery

from ..config import get_settings
from ..engines.inpainting import (
    TemporalFillEngine,
    device_name,
    empty_cache,
    process_windowed,
)
from ..engines.diffueraser_official import (
    DiffuEraserUnavailable,
    diffueraser_status,
    run_diffueraser,
)
from ..engines.propainter_official import (
    ProPainterUnavailable,
    propainter_status,
    run_propainter,
)
from ..services import mask as mask_svc
from ..services import protect as protect_svc
from ..services import tracking
from ..services import verify
from ..services.scene import detect_scenes
from ..services.text_detect import detect_text_boxes, frame_text_mask
from ..services.watermark import detect_watermarks, frame_watermark_mask
from ..security import callback_signature, validate_callback_url
from ..storage import job_dir as safe_job_dir, read_state, write_state
from ..utils.video import (
    RawWriter,
    masks_to_video,
    mux_audio,
    normalize_video,
    probe,
    read_chunk,
    read_frames,
)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("cleaner_tasks", broker=REDIS_URL, backend=REDIS_URL)

SETTINGS = get_settings()
WORKER_SECRET = SETTINGS.worker_secret
STORAGE_DIR = str(SETTINGS.storage_dir)


class JobCancelled(RuntimeError):
    pass


def sign_payload(payload: dict, secret: str) -> str:
    return hmac.new(secret.encode(), json.dumps(payload, sort_keys=True).encode(),
                    hashlib.sha256).hexdigest()


def _notify(callback_url: Optional[str], payload: dict) -> None:
    if not callback_url:
        return
    try:
        callback_url = validate_callback_url(callback_url, SETTINGS.callback_origins)
        body = json.dumps(payload, sort_keys=True)
        timestamp = str(int(time.time()))
        requests.post(
            callback_url,
            data=body,
            headers={
                "content-type": "application/json",
                "x-callback-timestamp": timestamp,
                "x-signature": callback_signature(WORKER_SECRET, timestamp, body),
            },
            timeout=5,
            allow_redirects=False,
        )
    except Exception as exc:  # pragma: no cover
        print(f"[callback] delivery failed: {type(exc).__name__}")


def auto_detect(job_id: str, mode: str, samples: int = 12) -> List[Dict]:
    """Detecção automática de regiões conforme o modo escolhido."""
    input_path = os.path.join(STORAGE_DIR, job_id, "input.mp4")
    info = probe(input_path)
    step = max(1, info.frames // samples)
    frames = [f for i, f in enumerate(read_frames(input_path)) if i % step == 0][:samples]
    if not frames:
        return []
    h, w = frames[0].shape[:2]

    if mode in ("watermark", "logo"):
        return detect_watermarks(frames)

    if mode in ("subtitle", "text", "smart"):
        heat = np.zeros((h, w), np.float32)
        for frame in frames:
            layer = np.zeros((h, w), np.uint8)
            for box in detect_text_boxes(frame):
                x, y, bw, bh = box
                if mode == "subtitle" and (y + bh / 2) < h * 0.45:
                    continue  # legenda vive no terço inferior
                cv2.rectangle(layer, (x, y), (x + bw, y + bh), 255, -1)
            heat += layer.astype(np.float32) / 255.0
        binary = np.where(heat >= max(2.0, len(frames) * 0.25), 255, 0).astype(np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (25, 9)))
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        regions: List[Dict] = []
        for i, c in enumerate(contours):
            x, y, bw, bh = cv2.boundingRect(c)
            if bw * bh < w * h * 0.0008:
                continue
            regions.append({
                "id": f"det_{i}",
                "kind": "rect",
                "role": "remove",
                "x": x / w, "y": y / h, "w": bw / w, "h": bh / h,
                "grow": 0.008,
                "label": "Legenda" if mode == "subtitle" else "Texto",
            })
        if mode == "smart":
            regions += detect_watermarks(frames)
        return regions

    return []


def _window_masks(
    frames,
    regions,
    info,
    mode,
    dynamic,
    key_step,
    frame_offset: int,
    auto_protect: bool,
):
    """Build frame-accurate masks for one absolute video window."""
    n = len(frames)
    h, w = info.height, info.width
    base_masks, protect_masks = mask_svc.build_masks_window(
        regions, w, h, frame_offset, n, info.fps
    )
    fixed_watermark_masks = np.zeros_like(base_masks)
    if mode in ("watermark", "logo"):
        fixed_regions = []
        for region in regions:
            region_id = str(region.get("id", ""))
            label = str(region.get("label", "")).lower()
            automatically_moving = region_id.startswith(("wt_", "mv_"))
            is_fixed = mode == "logo" or (
                not automatically_moving
                and ("persistente" in label or not region_id.startswith("wm_"))
            )
            if is_fixed:
                fixed_regions.append(region)
        if fixed_regions:
            fixed_watermark_masks, _ = mask_svc.build_masks_window(
                fixed_regions, w, h, frame_offset, n, info.fps
            )

    if mode in ("subtitle", "text", "smart", "watermark", "logo") and dynamic:
        keys = list(range(0, n, max(1, key_step)))
        if keys[-1] != n - 1:
            keys.append(n - 1)
        key_masks = []
        for key in keys:
            base = base_masks[key]
            if mode in ("watermark", "logo"):
                detected = frame_watermark_mask(frames[key], roi=base)
                detected = np.maximum(detected, fixed_watermark_masks[key])
                if detected.max() == 0:
                    detected = base.copy()
            else:
                detected = frame_text_mask(
                    frames[key], roi=base, subtitle_only=(mode == "subtitle")
                )
                if mode == "smart":
                    detected = np.maximum(
                        detected, frame_watermark_mask(frames[key], roi=base)
                    )
            key_masks.append(detected)
        masks = tracking.interpolate_keyframes(frames, keys, key_masks)
    else:
        masks = [base.copy() for base in base_masks]

    # Person protection must not preserve an overlay crossing a person.
    if auto_protect and mode == "object":
        automatic = protect_svc.sampled_protect_mask(frames, step=max(2, n // 6))
        if automatic is not None:
            protect_masks = np.maximum(protect_masks, automatic[None, ...])

    out = np.zeros((n, h, w), np.uint8)
    for index, current in enumerate(masks):
        current = cv2.bitwise_and(current, base_masks[index])
        if protect_masks[index].max() > 0:
            current = cv2.bitwise_and(current, cv2.bitwise_not(protect_masks[index]))
        out[index] = mask_svc.refine(current)
    return out


def _write_mask_sequence(
    input_path: str,
    mask_dir: str,
    regions: List[Dict],
    info,
    mode: str,
    dynamic: bool,
    key_step: int,
    auto_protect: bool,
    on_progress=None,
) -> int:
    target = Path(mask_dir)
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    total = max(1, info.frames)
    core = 72
    overlap = 8
    written = 0
    start = 0
    while start < total:
        context_start = max(0, start - overlap)
        read_len = min(total, start + core + overlap) - context_start
        frames = read_chunk(input_path, context_start, read_len)
        if not frames:
            break
        masks = _window_masks(
            frames,
            regions,
            info,
            mode,
            dynamic,
            key_step,
            context_start,
            auto_protect,
        )
        masks = tracking.stabilize(masks) if len(masks) > 2 else masks
        offset = start - context_start
        core_len = min(core, total - start, len(frames) - offset)
        for local in range(offset, offset + core_len):
            output = target / f"{written:06d}.png"
            if not cv2.imwrite(str(output), masks[local]):
                raise RuntimeError(f"falha ao gravar mascara {output}")
            written += 1
        if on_progress:
            on_progress(written / total)
        start += core_len
        if core_len <= 0:
            break
    if written == 0:
        raise RuntimeError("nenhuma mascara foi gerada")
    return written


def _audit_video(video_path: str, mask_dir: str, fps: float) -> tuple[List[Dict], dict]:
    segments: List[Dict] = []
    worst = {"residual_text": 0.0, "sharpness_ratio": 1.0, "temporal_consistency": 1.0}
    chunk_frames: List[np.ndarray] = []
    chunk_masks: List[np.ndarray] = []
    start_frame = 0

    def flush() -> None:
        nonlocal start_frame
        if not chunk_frames:
            return
        mask_array = np.asarray(chunk_masks, dtype=np.uint8)
        _, metrics = verify.audit_window(chunk_frames, mask_array)
        coverage = float(np.mean([(mask > 0).mean() for mask in chunk_masks]))
        segments.append({
            "from": round(start_frame / fps, 3),
            "to": round((start_frame + len(chunk_frames)) / fps, 3),
            "coverage": round(coverage, 5),
            **metrics,
        })
        worst["residual_text"] = max(worst["residual_text"], metrics["residual_text"])
        worst["sharpness_ratio"] = min(worst["sharpness_ratio"], metrics["sharpness_ratio"])
        worst["temporal_consistency"] = min(
            worst["temporal_consistency"], metrics["temporal_consistency"]
        )
        start_frame += len(chunk_frames)
        chunk_frames.clear()
        chunk_masks.clear()

    for index, frame in enumerate(read_frames(video_path)):
        mask = cv2.imread(str(Path(mask_dir) / f"{index:06d}.png"), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            break
        chunk_frames.append(frame)
        chunk_masks.append(mask)
        if len(chunk_frames) >= 48:
            flush()
    flush()
    return segments, worst


def _run_official_pipeline(
    input_path: str,
    output_path: str,
    job_dir: str,
    regions: List[Dict],
    info,
    mode: str,
    preset: str,
    dynamic: bool,
    key_step: int,
    auto_protect: bool,
    verify_on: bool,
    emit,
    cancel_file: Optional[str] = None,
) -> tuple[List[Dict], dict, int]:
    mask_dir = os.path.join(job_dir, "masks")
    run_dir = os.path.join(job_dir, "propainter-run")
    emit(18, "gerando mascaras temporais", "tracking")
    frames = _write_mask_sequence(
        input_path,
        mask_dir,
        regions,
        info,
        mode,
        dynamic,
        key_step,
        auto_protect,
        lambda ratio: emit(18 + ratio * 14, "gerando mascaras temporais", "tracking"),
    )
    emit(34, "iniciando ProPainter oficial", "inpainting")
    video_only = run_propainter(
        input_path,
        mask_dir,
        run_dir,
        info.width,
        info.height,
        info.fps,
        preset,
        lambda stage: emit(36, stage, "inpainting"),
        cancel_file,
    )
    normalized_video = normalize_video(
        video_only,
        os.path.join(job_dir, "propainter-native.mp4"),
        info.width,
        info.height,
        info.fps,
    )
    emit(91, "validando resultado", "refining")
    if verify_on:
        segments, metrics = _audit_video(normalized_video, mask_dir, info.fps)
    else:
        segments = []
        metrics = {"residual_text": 0.0, "sharpness_ratio": 1.0, "temporal_consistency": 1.0}
    emit(96, "remontando audio", "encoding")
    mux_audio(normalized_video, input_path, output_path, info.has_audio)
    return segments, metrics, frames


def _run_diffusion_pipeline(
    input_path: str,
    output_path: str,
    job_dir: str,
    regions: List[Dict],
    info,
    mode: str,
    dynamic: bool,
    key_step: int,
    auto_protect: bool,
    verify_on: bool,
    emit,
    cancel_file: Optional[str] = None,
) -> tuple[List[Dict], dict, int]:
    mask_dir = os.path.join(job_dir, "masks")
    mask_video = os.path.join(job_dir, "masks.mp4")
    run_dir = os.path.join(job_dir, "diffueraser-run")
    emit(18, "gerando mascaras temporais", "tracking")
    frames = _write_mask_sequence(
        input_path,
        mask_dir,
        regions,
        info,
        mode,
        dynamic,
        key_step,
        auto_protect,
        lambda ratio: emit(18 + ratio * 12, "gerando mascaras temporais", "tracking"),
    )
    masks_to_video(mask_dir, mask_video, info.fps)
    emit(32, "iniciando DiffuEraser oficial", "inpainting")
    video_only = run_diffueraser(
        input_path,
        mask_video,
        run_dir,
        info.duration,
        lambda stage: emit(34, stage, "inpainting"),
        cancel_file,
    )
    normalized_video = normalize_video(
        video_only,
        os.path.join(job_dir, "diffueraser-native.mp4"),
        info.width,
        info.height,
        info.fps,
    )
    emit(92, "validando resultado", "refining")
    if verify_on:
        segments, metrics = _audit_video(normalized_video, mask_dir, info.fps)
    else:
        segments = []
        metrics = {"residual_text": 0.0, "sharpness_ratio": 1.0, "temporal_consistency": 1.0}
    emit(96, "remontando audio", "encoding")
    mux_audio(normalized_video, input_path, output_path, info.has_audio)
    return segments, metrics, frames


def _run_classic_pipeline(
    input_path: str,
    tmp_path: str,
    output_path: str,
    regions: List[Dict],
    info,
    cuts: List[int],
    mode: str,
    dynamic: bool,
    key_step: int,
    auto_protect: bool,
    verify_on: bool,
    emit,
) -> tuple[List[Dict], dict, int, str]:
    engine = TemporalFillEngine(14)
    core = 20
    overlap = 5
    total = max(1, info.frames)
    writer = RawWriter(tmp_path, info.width, info.height, info.fps)
    segments: List[Dict] = []
    written = 0
    start = 0
    worst = {"residual_text": 0.0, "sharpness_ratio": 1.0, "temporal_consistency": 1.0}
    emit(20, f"reconstrucao temporal classica ({device_name()})", "inpainting")
    try:
        while start < total:
            context_start = max(0, start - overlap)
            read_len = min(total, start + core + overlap) - context_start
            frames = read_chunk(input_path, context_start, read_len)
            if not frames:
                break
            end = min(total, start + core)
            for cut in cuts:
                if start < cut < end:
                    end = cut
                    break
            core_len = end - start
            masks = _window_masks(
                frames,
                regions,
                info,
                mode,
                dynamic,
                key_step,
                context_start,
                auto_protect,
            )
            masks = tracking.stabilize(masks) if len(masks) > 2 else masks
            result = process_windowed(engine, list(frames), masks, len(frames), 0)
            metrics = {"residual_text": 0.0, "sharpness_ratio": 1.0, "temporal_consistency": 1.0}
            if verify_on:
                _, metrics = verify.audit_window(result, masks)
            offset = start - context_start
            for index in range(offset, offset + core_len):
                if index < len(result):
                    writer.write(result[index])
                    written += 1
            selected = masks[offset:offset + core_len]
            coverage = float(np.mean([(mask > 0).mean() for mask in selected])) if len(selected) else 0.0
            segments.append({
                "from": round(start / info.fps, 3),
                "to": round(end / info.fps, 3),
                "coverage": round(coverage, 5),
                **metrics,
            })
            worst["residual_text"] = max(worst["residual_text"], metrics["residual_text"])
            worst["sharpness_ratio"] = min(worst["sharpness_ratio"], metrics["sharpness_ratio"])
            worst["temporal_consistency"] = min(
                worst["temporal_consistency"], metrics["temporal_consistency"]
            )
            emit(
                min(92.0, 20 + (written / total) * 70),
                f"reconstruindo fundo ({written}/{total} frames)",
                "inpainting",
            )
            start = end
    finally:
        writer.close()
    emit(95, "remontando audio", "encoding")
    mux_audio(tmp_path, input_path, output_path, info.has_audio)
    return segments, worst, written, engine.name


def run_pipeline(
    job_id: str,
    mode: str,
    preset: str,
    masks_data: List[Dict],
    callback_url: Optional[str] = None,
    progress_cb=None,
    options: Optional[Dict] = None,
) -> Dict:
    opts = options or {}
    dynamic = bool(opts.get("dynamic", True))
    auto_protect = bool(opts.get("protect_subject", True))
    key_step = int(opts.get("key_step", 4))
    verify_on = bool(opts.get("verify", True))

    job_path = safe_job_dir(SETTINGS.storage_dir, job_id)
    cancel_path = job_path / ".cancel"
    cancel_path.unlink(missing_ok=True)
    job_dir = str(job_path)
    input_path = str(job_path / "input.mp4")
    tmp_path = str(job_path / "video_only.mp4")
    output_path = str(job_path / "output.mp4")
    callback_seq = int(read_state(job_path).get("callback_seq", 0))

    def emit(progress: float, stage: str, status: str = "processing", **extra) -> None:
        nonlocal callback_seq
        if cancel_path.exists():
            raise JobCancelled("job cancelado")
        callback_seq += 1
        if progress_cb:
            progress_cb(progress, stage)
        payload = {
            "job_id": job_id, "status": status, "stage": stage,
            "progress": round(progress, 1), "callback_seq": callback_seq, **extra,
        }
        write_state(job_path, {**read_state(job_path), **payload})
        _notify(callback_url, payload)

    try:
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"vídeo de entrada ausente para {job_id}")

        emit(3, "analisando vídeo", "analyzing")
        info = probe(input_path)

        emit(8, "detectando cortes de cena", "analyzing")
        scenes = detect_scenes(input_path)
        cuts = sorted({int(s) for s, _ in scenes})

        regions = list(masks_data or [])
        if not regions:
            emit(14, "detectando áreas automaticamente", "detecting")
            regions = auto_detect(job_id, mode)
        if not regions:
            raise ValueError("nenhuma área para remover foi detectada ou marcada")

        official = propainter_status()
        diffusion = diffueraser_status()
        allow_fallback = os.getenv("CLEANER_ALLOW_CLASSIC_FALLBACK", "0") == "1"
        if preset == "max" and diffusion.ready:
            segments, aggregate, written = _run_diffusion_pipeline(
                input_path,
                output_path,
                job_dir,
                regions,
                info,
                mode,
                dynamic,
                key_step,
                auto_protect,
                verify_on,
                emit,
                str(cancel_path),
            )
            engine_name = "diffueraser-official"
            pass_count = 2
        elif preset == "max" and not allow_fallback:
            raise DiffuEraserUnavailable(
                "preset max solicitado, mas DiffuEraser oficial nao esta pronto: "
                + ", ".join(diffusion.missing)
            )
        elif preset in ("quality", "max") and official.ready:
            segments, aggregate, written = _run_official_pipeline(
                input_path,
                output_path,
                job_dir,
                regions,
                info,
                mode,
                preset,
                dynamic,
                key_step,
                auto_protect,
                verify_on,
                emit,
                str(cancel_path),
            )
            engine_name = "propainter-official"
            pass_count = 1
        else:
            if preset == "quality" and not allow_fallback:
                raise ProPainterUnavailable(
                    "preset de IA solicitado, mas ProPainter oficial nao esta pronto: "
                    + ", ".join(official.missing)
                )
            segments, aggregate, written, engine_name = _run_classic_pipeline(
                input_path,
                tmp_path,
                output_path,
                regions,
                info,
                cuts,
                mode,
                dynamic,
                key_step,
                auto_protect,
                verify_on,
                emit,
            )
            pass_count = 1

        callback_seq += 1
        result_payload = {
            "job_id": job_id,
            "callback_seq": callback_seq,
            "status": "completed",
            "progress": 100,
            "stage": "concluído",
            "result_url": f"/v1/jobs/{job_id}/result",
            "detections": regions,
            "segments": segments,
            "metrics": {
                "temporal_consistency": round(aggregate["temporal_consistency"], 3),
                "sharpness_ratio": round(aggregate["sharpness_ratio"], 3),
                "residual_text": round(aggregate["residual_text"], 4),
                "device": device_name(),
                "frames": written,
                "engine": engine_name,
                "passes": pass_count,
                "dynamic_masks": dynamic,
                "subject_protection": auto_protect,
            },
            "probe": {
                "width": info.width, "height": info.height,
                "fps": round(info.fps, 3), "duration": round(info.duration, 3),
                "has_audio": info.has_audio,
            },
        }
        write_state(job_path, {**read_state(job_path), **result_payload})
        _notify(callback_url, result_payload)
        return result_payload

    except Exception as exc:
        empty_cache()
        print(f"[pipeline] falhou: {exc}")
        callback_seq += 1
        failure = {"job_id": job_id, "callback_seq": callback_seq, "status": "failed",
                   "progress": 0, "error": str(exc)[:1000]}
        write_state(job_path, {**read_state(job_path), **failure})
        _notify(callback_url, failure)
        raise


@celery_app.task(name="process_video_task", bind=True)
def process_video_task(self, job_id: str, mode: str, preset: str,
                       masks_data: list, callback_url: str, options: dict | None = None):
    def progress_cb(progress: float, stage: str) -> None:
        self.update_state(state="PROGRESS", meta={"progress": progress, "stage": stage})

    return run_pipeline(job_id, mode, preset, masks_data, callback_url, progress_cb, options)
