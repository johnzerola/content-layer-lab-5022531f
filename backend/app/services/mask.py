"""Construção e refino de máscaras binárias."""
from __future__ import annotations

from typing import Dict, List, Sequence

import cv2
import numpy as np


def region_to_mask(region: Dict, width: int, height: int) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    kind = region.get("kind", "rect")

    if kind == "poly" and region.get("points"):
        pts = np.array(
            [[int(p["x"] * width), int(p["y"] * height)] for p in region["points"]],
            dtype=np.int32,
        )
        cv2.fillPoly(mask, [pts], 255)
    elif kind == "brush" and region.get("points"):
        radius = max(2, int(float(region.get("radius", 0.02)) * max(width, height)))
        prev = None
        for p in region["points"]:
            cur = (int(p["x"] * width), int(p["y"] * height))
            cv2.circle(mask, cur, radius, 255, -1)
            if prev is not None:
                cv2.line(mask, prev, cur, 255, radius * 2)
            prev = cur
    else:
        x = int(float(region.get("x", 0)) * width)
        y = int(float(region.get("y", 0)) * height)
        w = int(float(region.get("w", 0)) * width)
        h = int(float(region.get("h", 0)) * height)
        cv2.rectangle(mask, (max(0, x), max(0, y)), (min(width, x + w), min(height, y + h)), 255, -1)

    grow = float(region.get("grow", 0) or 0)
    if grow > 0:
        k = max(3, int(grow * max(width, height)) | 1)
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return mask


def build_masks(
    regions: Sequence[Dict],
    width: int,
    height: int,
    total_frames: int,
    fps: float,
) -> np.ndarray:
    """(T, H, W) uint8. `role=protect` sempre subtrai do resultado final."""
    masks = np.zeros((total_frames, height, width), dtype=np.uint8)
    protects: List[tuple] = []

    for region in regions:
        m = region_to_mask(region, width, height)
        start = int(float(region.get("from") or region.get("from_time") or 0) * fps)
        end_val = region.get("to", region.get("to_time"))
        end = int(float(end_val) * fps) if end_val is not None else total_frames
        start = max(0, min(total_frames, start))
        end = max(start, min(total_frames, end))
        if region.get("role") == "protect":
            protects.append((m, start, end))
        else:
            for f in range(start, end):
                masks[f] = np.maximum(masks[f], m)

    for m, start, end in protects:
        inv = cv2.bitwise_not(m)
        for f in range(start, end):
            masks[f] = cv2.bitwise_and(masks[f], inv)

    return masks


def build_masks_window(
    regions: Sequence[Dict],
    width: int,
    height: int,
    start_frame: int,
    frame_count: int,
    fps: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Build remove/protect masks for an absolute frame window.

    Returning both layers keeps time-ranged protect regions accurate and avoids
    flattening a moving job into one mask that applies for the entire video.
    """
    removes = np.zeros((frame_count, height, width), dtype=np.uint8)
    protects = np.zeros_like(removes)
    window_end = start_frame + frame_count
    for region in regions:
        if region.get("enabled") is False:
            continue
        first = int(float(region.get("from") or region.get("from_time") or 0) * fps)
        end_value = region.get("to", region.get("to_time"))
        last = int(float(end_value) * fps) if end_value is not None else window_end
        local_first = max(0, first - start_frame)
        local_last = min(frame_count, last - start_frame)
        if local_last <= local_first:
            continue
        target = protects if region.get("role") == "protect" else removes
        region_mask = region_to_mask(region, width, height)
        target[local_first:local_last] = np.maximum(
            target[local_first:local_last], region_mask[None, ...]
        )
    return removes, protects


def refine(mask: np.ndarray, feather: int = 3) -> np.ndarray:
    """Fecha buracos, remove ruído e suaviza a borda mantendo binário."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    out = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    out = cv2.morphologyEx(out, cv2.MORPH_OPEN,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    if feather > 0:
        blur = cv2.GaussianBlur(out, (feather * 2 + 1, feather * 2 + 1), 0)
        out = np.where(blur > 40, 255, 0).astype(np.uint8)
    return out


def limit_to_scene(masks: np.ndarray, scenes: Sequence[tuple]) -> np.ndarray:
    """Reinicia a máscara em cada corte de cena (sem herdar a cena anterior)."""
    out = masks.copy()
    for start, end in scenes:
        if end - start <= 1:
            continue
        # dentro da cena, estabiliza usando a união dos primeiros frames
        window = out[start:min(end, start + 8)]
        if window.size:
            stable = np.max(window, axis=0)
            out[start:end] = np.maximum(out[start:end], stable[None, ...])
    return out
