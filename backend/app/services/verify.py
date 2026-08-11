"""Verificação automática do resultado.

Duas perguntas objetivas depois de limpar:
  1. Sobrou texto legível dentro da área que devia estar limpa?
  2. A área reconstruída ficou mais lisa que a vizinhança (sinal de borrão)?

Quem responde "sim" para qualquer uma delas volta para reprocessamento.
"""
from __future__ import annotations

from typing import List, Tuple

import cv2
import numpy as np

from .text_detect import detect_text_boxes


def residual_text(frame: np.ndarray, mask: np.ndarray) -> float:
    """0..1 — quanto da área limpa ainda parece conter texto."""
    if mask.max() == 0:
        return 0.0
    area = float((mask > 0).sum())
    if area <= 0:
        return 0.0
    layer = np.zeros(mask.shape, np.uint8)
    for (x, y, w, h) in detect_text_boxes(frame):
        cv2.rectangle(layer, (x, y), (x + w, y + h), 255, -1)
    hit = cv2.bitwise_and(layer, mask)
    return float((hit > 0).sum()) / area


def _laplacian_var(gray: np.ndarray, sel: np.ndarray) -> float:
    if sel.sum() < 40:
        return -1.0
    lap = cv2.Laplacian(gray, cv2.CV_32F)
    return float(np.var(lap[sel]))


def blur_ratio(frame: np.ndarray, mask: np.ndarray, ring: int = 14) -> float:
    """Nitidez dentro da máscara dividida pela nitidez do anel ao redor.

    < 1 significa área reconstruída mais lisa que o entorno (borrão)."""
    if mask.max() == 0:
        return 1.0
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    inside = mask > 0
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ring * 2 + 1, ring * 2 + 1))
    around = (cv2.dilate(mask, k) > 0) & ~inside
    vin = _laplacian_var(gray, inside)
    vout = _laplacian_var(gray, around)
    if vin < 0 or vout <= 1e-6:
        return 1.0
    return float(vin / vout)


def temporal_score(frames: List[np.ndarray], masks: np.ndarray) -> float:
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


def audit_window(
    frames: List[np.ndarray],
    masks: np.ndarray,
    step: int = 4,
    text_thresh: float = 0.05,
    blur_thresh: float = 0.55,
) -> Tuple[bool, dict]:
    """Retorna (precisa_reprocessar, métricas) para uma janela já processada."""
    texts: List[float] = []
    blurs: List[float] = []
    for i in range(0, len(frames), max(1, step)):
        if masks[i].max() == 0:
            continue
        texts.append(residual_text(frames[i], masks[i]))
        blurs.append(blur_ratio(frames[i], masks[i]))
    text = max(texts) if texts else 0.0
    blur = min(blurs) if blurs else 1.0
    temporal = temporal_score(frames, masks)
    need = text > text_thresh or blur < blur_thresh or temporal < 0.55
    return need, {
        "residual_text": round(text, 4),
        "sharpness_ratio": round(blur, 3),
        "temporal_consistency": round(temporal, 3),
    }
