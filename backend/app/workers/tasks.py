"""Pipeline assíncrona completa (Celery, com fallback para execução inline).

video → scene detection → text detection → mask generation → refinement
      → temporal tracking → inpainting → validação temporal → encoding
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Dict, List, Optional

import cv2
import numpy as np
import requests
from celery import Celery

from ..engines.inpainting import (
    LamaEngine,
    build_engine,
    cuda_available,
    device_name,
    empty_cache,
    passes_for,
    process_windowed,
)
from ..services import mask as mask_svc
from ..services.scene import detect_scenes
from ..services.text_detect import detect_text_boxes, text_pixel_mask
from ..services.tracking import stabilize
from ..services.watermark import detect_watermarks
from ..utils.video import RawWriter, mux_audio, probe, read_chunk, read_frames

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("cleaner_tasks", broker=REDIS_URL, backend=REDIS_URL)

WORKER_SECRET = os.getenv("CLEANER_WORKER_SECRET", "default_secret")
STORAGE_DIR = os.getenv("CLEANER_STORAGE", "storage")


def sign_payload(payload: dict, secret: str) -> str:
    return hmac.new(secret.encode(), json.dumps(payload, sort_keys=True).encode(),
                    hashlib.sha256).hexdigest()


def _notify(callback_url: Optional[str], payload: dict) -> None:
    if not callback_url:
        return
    try:
        requests.post(callback_url, json=payload,
                      headers={"x-signature": sign_payload(payload, WORKER_SECRET)}, timeout=5)
    except Exception as exc:  # pragma: no cover
        print(f"[callback] {exc}")


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


def _temporal_score(frames: List[np.ndarray], masks: np.ndarray) -> float:
    """Consistência temporal do resultado dentro das áreas reconstruídas."""
    diffs = []
    for i in range(1, len(frames)):
        area = masks[i] > 0
        if not area.any():
            continue
        a = frames[i][area].astype(np.float32)
        b = frames[i - 1][area].astype(np.float32)
        if a.shape != b.shape:
            continue
        diffs.append(float(np.mean(np.abs(a - b)) / 255.0))
    if not diffs:
        return 1.0
    return max(0.0, 1.0 - float(np.mean(diffs)) * 4.0)


def run_pipeline(
    job_id: str,
    mode: str,
    preset: str,
    masks_data: List[Dict],
    callback_url: Optional[str] = None,
    progress_cb=None,
) -> Dict:
    job_dir = os.path.join(STORAGE_DIR, job_id)
    input_path = os.path.join(job_dir, "input.mp4")
    tmp_path = os.path.join(job_dir, "video_only.mp4")
    output_path = os.path.join(job_dir, "output.mp4")

    def emit(progress: float, stage: str, status: str = "processing", **extra) -> None:
        if progress_cb:
            progress_cb(progress, stage)
        _notify(callback_url, {
            "job_id": job_id, "status": status, "stage": stage,
            "progress": round(progress, 1), **extra,
        })

    try:
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"vídeo de entrada ausente para {job_id}")

        emit(3, "analisando vídeo", "analyzing")
        info = probe(input_path)

        emit(8, "detectando cortes de cena", "analyzing")
        scenes = detect_scenes(input_path)

        regions = list(masks_data or [])
        if not regions:
            emit(14, "detectando áreas automaticamente", "detecting")
            regions = auto_detect(job_id, mode)
        if not regions:
            raise ValueError("nenhuma área para remover foi detectada ou marcada")

        emit(20, "gerando máscaras", "tracking")
        masks = mask_svc.build_masks(regions, info.width, info.height, info.frames, info.fps)

        # refino em nível de pixel para legenda/texto: só letra+stroke+sombra
        if mode in ("subtitle", "text", "smart"):
            step = max(1, info.frames // 40)
            for idx in range(0, info.frames, step):
                frame_list = read_chunk(input_path, idx, 1)
                if not frame_list:
                    break
                pixel = np.zeros((info.height, info.width), np.uint8)
                for region in regions:
                    if region.get("role") == "protect":
                        continue
                    box_mask = mask_svc.region_to_mask(region, info.width, info.height)
                    xs, ys = np.where(box_mask > 0)[1], np.where(box_mask > 0)[0]
                    if xs.size == 0:
                        continue
                    box = (int(xs.min()), int(ys.min()),
                           int(xs.max() - xs.min()), int(ys.max() - ys.min()))
                    pixel = np.maximum(pixel, text_pixel_mask(frame_list[0], box))
                for f in range(idx, min(info.frames, idx + step)):
                    masks[f] = np.maximum(masks[f], pixel)

        for i in range(len(masks)):
            masks[i] = mask_svc.refine(masks[i])
        masks = mask_svc.limit_to_scene(masks, scenes)

        emit(28, "estabilizando máscara no tempo", "tracking")
        for start, end in scenes:
            if end > start + 1:
                masks[start:end] = stabilize(masks[start:end])

        emit(32, f"reconstruindo fundo ({device_name()})", "inpainting")
        engine = build_engine(preset)
        n_passes = passes_for(preset)
        chunk = 80 if cuda_available() else 24
        overlap = 16 if cuda_available() else 6

        frames = list(read_frames(input_path))
        total = min(len(frames), len(masks))
        frames, masks = frames[:total], masks[:total]

        for p in range(n_passes):
            base = 32 + p * (45 / n_passes)
            span = 45 / n_passes

            def on_progress(ratio: float, base=base, span=span, p=p) -> None:
                emit(base + ratio * span, f"reconstruindo fundo (passe {p + 1}/{n_passes})",
                     "inpainting")

            frames = process_windowed(engine, frames, masks, chunk, overlap, on_progress)

        emit(80, "validando consistência temporal", "refining")
        score = _temporal_score(frames, masks)
        if score < 0.6:
            emit(84, "refinando resíduos", "refining")
            residual = LamaEngine()
            frames = process_windowed(residual, frames, masks, chunk, overlap)
            score = _temporal_score(frames, masks)

        emit(88, "codificando vídeo final", "encoding")
        writer = RawWriter(tmp_path, info.width, info.height, info.fps)
        for frame in frames:
            writer.write(frame)
        writer.close()
        empty_cache()

        emit(95, "remontando áudio", "encoding")
        mux_audio(tmp_path, input_path, output_path, info.has_audio)

        result = {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "stage": "concluído",
            "result_url": f"/v1/jobs/{job_id}/result",
            "detections": regions,
            "metrics": {
                "temporal_consistency": round(score, 3),
                "device": device_name(),
                "frames": total,
                "engine": engine.name,
            },
            "probe": {
                "width": info.width, "height": info.height,
                "fps": round(info.fps, 3), "duration": round(info.duration, 3),
                "has_audio": info.has_audio,
            },
        }
        _notify(callback_url, result)
        return result

    except Exception as exc:
        empty_cache()
        print(f"[pipeline] falhou: {exc}")
        _notify(callback_url, {"job_id": job_id, "status": "failed",
                               "progress": 0, "error": str(exc)})
        raise


@celery_app.task(name="process_video_task", bind=True)
def process_video_task(self, job_id: str, mode: str, preset: str,
                       masks_data: list, callback_url: str):
    def progress_cb(progress: float, stage: str) -> None:
        self.update_state(state="PROGRESS", meta={"progress": progress, "stage": stage})

    return run_pipeline(job_id, mode, preset, masks_data, callback_url, progress_cb)
