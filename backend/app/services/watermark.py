"""Detecção de marca d'água: logo, username, watermark transparente/fixa/móvel."""
from __future__ import annotations

from typing import Dict, List

import cv2
import numpy as np

from .text_detect import detect_text_boxes
from .tracking import static_regions


def _boxes_from_mask(mask: np.ndarray, w: int, h: int, min_area: float = 0.0004) -> List[Dict]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out: List[Dict] = []
    for i, c in enumerate(contours):
        x, y, bw, bh = cv2.boundingRect(c)
        if (bw * bh) / float(w * h) < min_area:
            continue
        if bw > w * 0.9 and bh > h * 0.9:
            continue
        out.append({
            "id": f"wm_{i}",
            "kind": "rect",
            "role": "remove",
            "x": x / w, "y": y / h, "w": bw / w, "h": bh / h,
            "grow": 0.006,
            "label": "Marca d'água",
        })
    return out


def detect_watermarks(frames: List[np.ndarray]) -> List[Dict]:
    if not frames:
        return []
    h, w = frames[0].shape[:2]

    static = static_regions(frames)
    regions = _boxes_from_mask(static, w, h)

    # usernames / textos curtos persistentes (watermark móvel também cai aqui)
    persistent = np.zeros((h, w), np.uint8)
    for frame in frames[:: max(1, len(frames) // 8)]:
        layer = np.zeros((h, w), np.uint8)
        for (x, y, bw, bh) in detect_text_boxes(frame):
            if bw * bh < w * h * 0.25:
                cv2.rectangle(layer, (x, y), (x + bw, y + bh), 255, -1)
        persistent = cv2.add(persistent, layer // 8)
    persistent = np.where(persistent > 100, 255, 0).astype(np.uint8)
    regions += [{**r, "id": f"wt_{i}", "label": "Texto persistente"}
                for i, r in enumerate(_boxes_from_mask(persistent, w, h))]

    return regions
