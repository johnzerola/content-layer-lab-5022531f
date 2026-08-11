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
    TemporalFillEngine,
    build_engine,
    cuda_available,
    device_name,
    empty_cache,
    passes_for,
    process_windowed,
)
from ..services import mask as mask_svc
from ..services import protect as protect_svc
from ..services import tracking
from ..services import verify
from ..services.scene import detect_scenes
from ..services.text_detect import detect_text_boxes, frame_text_mask, text_pixel_mask
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


def _regions_roi(regions, width, height):
    """ROI onde a limpeza pode acontecer (união das regiões `remove`)."""
    roi = np.zeros((height, width), np.uint8)
    any_remove = False
    for region in regions:
        if region.get("role") == "protect":
            continue
        any_remove = True
        roi = np.maximum(roi, mask_svc.region_to_mask(region, width, height))
    if not any_remove:
        roi[:] = 255
    return roi


def _protect_static(regions, width, height):
    prot = np.zeros((height, width), np.uint8)
    for region in regions:
        if region.get("role") == "protect":
            prot = np.maximum(prot, mask_svc.region_to_mask(region, width, height))
    return prot


def _window_masks(frames, regions, info, mode, dynamic, key_step, roi, static_protect,
                  auto_protect: bool):
    """Máscara por frame da janela.

    Em modo texto/legenda a máscara é recalculada em frames-chave e
    interpolada por optical flow — é isso que acompanha legenda que muda
    durante o vídeo. Fora disso, usa a geometria marcada pelo usuário.
    """
    n = len(frames)
    h, w = info.height, info.width
    base = roi.copy()

    if mode in ("subtitle", "text", "smart") and dynamic:
        keys = list(range(0, n, max(1, key_step)))
        if keys[-1] != n - 1:
            keys.append(n - 1)
        key_masks = [
            frame_text_mask(frames[k], roi=base, subtitle_only=(mode == "subtitle"))
            for k in keys
        ]
        masks = tracking.interpolate_keyframes(frames, keys, key_masks)
    else:
        masks = [base.copy() for _ in range(n)]

    protect = static_protect.copy()
    if auto_protect:
        auto = protect_svc.sampled_protect_mask(frames, step=max(2, n // 6))
        if auto is not None:
            protect = np.maximum(protect, auto)

    inv = cv2.bitwise_not(protect) if protect.max() > 0 else None
    out = np.zeros((n, h, w), np.uint8)
    for i, m in enumerate(masks):
        m = cv2.bitwise_and(m, base)
        if inv is not None:
            m = cv2.bitwise_and(m, inv)
        out[i] = mask_svc.refine(m)
    return out


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
        cuts = sorted({int(s) for s, _ in scenes})

        regions = list(masks_data or [])
        if not regions:
            emit(14, "detectando áreas automaticamente", "detecting")
            regions = auto_detect(job_id, mode)
        if not regions:
            raise ValueError("nenhuma área para remover foi detectada ou marcada")

        roi = _regions_roi(regions, info.width, info.height)
        static_protect = _protect_static(regions, info.width, info.height)

        engine = build_engine(preset)
        n_passes = passes_for(preset)
        core = 64 if cuda_available() else 20
        overlap = 12 if cuda_available() else 5
        total = max(1, info.frames)

        emit(20, f"reconstruindo fundo ({device_name()})", "inpainting")
        writer = RawWriter(tmp_path, info.width, info.height, info.fps)
        segments: List[Dict] = []
        written = 0
        start = 0
        worst_temporal = 1.0
        worst_sharp = 1.0
        worst_text = 0.0

        while start < total:
            ctx_a = max(0, start - overlap)
            read_len = min(total, start + core + overlap) - ctx_a
            frames = read_chunk(input_path, ctx_a, read_len)
            if not frames:
                break
            # não atravessa corte de cena dentro da janela de contexto
            end = min(total, start + core)
            for cut in cuts:
                if start < cut < end:
                    end = cut
                    break
            core_len = end - start

            masks = _window_masks(frames, regions, info, mode, dynamic, key_step,
                                  roi, static_protect, auto_protect)
            masks = tracking.stabilize(masks) if len(masks) > 2 else masks

            result = list(frames)
            for _ in range(n_passes):
                result = process_windowed(engine, result, masks, len(result), 0)

            metrics = {"residual_text": 0.0, "sharpness_ratio": 1.0,
                       "temporal_consistency": 1.0}
            if verify_on:
                need, metrics = verify.audit_window(result, masks)
                if need:
                    emit(min(94.0, 20 + (written / total) * 70),
                         "reprocessando trecho com resíduo", "refining")
                    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
                    grown = np.array([cv2.dilate(m, k) for m in masks], dtype=np.uint8)
                    if static_protect.max() > 0:
                        invp = cv2.bitwise_not(static_protect)
                        grown = np.array([cv2.bitwise_and(m, invp) for m in grown],
                                         dtype=np.uint8)
                    retry = process_windowed(TemporalFillEngine(14), list(frames), grown,
                                             len(frames), 0)
                    retry = process_windowed(engine, retry, grown, len(retry), 0)
                    _, m2 = verify.audit_window(retry, grown)
                    if (m2["residual_text"] <= metrics["residual_text"]
                            and m2["sharpness_ratio"] >= metrics["sharpness_ratio"] * 0.95):
                        result, masks, metrics = retry, grown, m2

            offset = start - ctx_a
            for i in range(offset, offset + core_len):
                if i < len(result):
                    writer.write(result[i])
                    written += 1

            covered = float(np.mean([(m > 0).mean() for m in masks[offset:offset + core_len]])) \
                if core_len > 0 else 0.0
            segments.append({
                "from": round(start / info.fps, 3),
                "to": round(end / info.fps, 3),
                "coverage": round(covered, 5),
                **metrics,
            })
            worst_temporal = min(worst_temporal, metrics["temporal_consistency"])
            worst_sharp = min(worst_sharp, metrics["sharpness_ratio"])
            worst_text = max(worst_text, metrics["residual_text"])

            emit(min(92.0, 20 + (written / total) * 70),
                 f"reconstruindo fundo ({written}/{total} frames)", "inpainting")
            empty_cache()
            start = end

        writer.close()
        empty_cache()

        emit(95, "remontando áudio", "encoding")
        mux_audio(tmp_path, input_path, output_path, info.has_audio)

        result_payload = {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "stage": "concluído",
            "result_url": f"/v1/jobs/{job_id}/result",
            "detections": regions,
            "segments": segments,
            "metrics": {
                "temporal_consistency": round(worst_temporal, 3),
                "sharpness_ratio": round(worst_sharp, 3),
                "residual_text": round(worst_text, 4),
                "device": device_name(),
                "frames": written,
                "engine": engine.name,
                "dynamic_masks": dynamic,
                "subject_protection": auto_protect,
            },
            "probe": {
                "width": info.width, "height": info.height,
                "fps": round(info.fps, 3), "duration": round(info.duration, 3),
                "has_audio": info.has_audio,
            },
        }
        _notify(callback_url, result_payload)
        return result_payload

    except Exception as exc:
        empty_cache()
        print(f"[pipeline] falhou: {exc}")
        _notify(callback_url, {"job_id": job_id, "status": "failed",
                               "progress": 0, "error": str(exc)})
        raise


@celery_app.task(name="process_video_task", bind=True)
def process_video_task(self, job_id: str, mode: str, preset: str,
                       masks_data: list, callback_url: str, options: dict | None = None):
    def progress_cb(progress: float, stage: str) -> None:
        self.update_state(state="PROGRESS", meta={"progress": progress, "stage": stage})

    return run_pipeline(job_id, mode, preset, masks_data, callback_url, progress_cb, options)
