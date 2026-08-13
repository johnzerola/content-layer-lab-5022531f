"""Detection of fixed, translucent and text-based watermarks."""
from __future__ import annotations

from typing import Dict, List

import cv2
import numpy as np

from .text_detect import detect_text_boxes, text_pixel_mask


def _boxes_from_mask(
    mask: np.ndarray,
    width: int,
    height: int,
    prefix: str,
    label: str,
    min_area: float = 0.00025,
) -> List[Dict]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out: List[Dict] = []
    for index, contour in enumerate(contours):
        x, y, w, h = cv2.boundingRect(contour)
        ratio = (w * h) / float(width * height)
        if ratio < min_area or ratio > 0.35:
            continue
        if w > width * 0.94 or h > height * 0.6:
            continue
        out.append({
            "id": f"{prefix}_{index}",
            "kind": "rect",
            "role": "remove",
            "x": x / width,
            "y": y / height,
            "w": w / width,
            "h": h / height,
            "grow": 0.006,
            "label": label,
            "score": min(0.99, 0.65 + ratio * 2.0),
        })
    return out


def frame_watermark_mask(frame: np.ndarray, roi: np.ndarray | None = None) -> np.ndarray:
    """Per-frame glyph mask for moving usernames and text watermarks."""
    height, width = frame.shape[:2]
    out = np.zeros((height, width), np.uint8)
    for box in detect_text_boxes(frame):
        x, y, w, h = box
        if w * h > width * height * 0.2:
            continue
        if roi is not None:
            section = roi[max(0, y):y + h, max(0, x):x + w]
            if section.size == 0 or (section > 0).mean() < 0.12:
                continue
        out = np.maximum(out, text_pixel_mask(frame, box, dilate_ratio=0.22))
    if roi is not None:
        out = cv2.bitwise_and(out, roi)
    return out


def detect_watermarks(frames: List[np.ndarray]) -> List[Dict]:
    if not frames:
        return []
    height, width = frames[0].shape[:2]
    count = len(frames)

    # Alpha-blended logos keep screen-space edges even when the background
    # moves. Edge persistence is therefore more useful than raw pixel stddev.
    edge_hits = np.zeros((height, width), np.float32)
    text_hits = np.zeros((height, width), np.float32)
    moving_text = np.zeros((height, width), np.uint8)
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 55, 150)
        edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        edge_hits += (edges > 0).astype(np.float32)
        for x, y, w, h in detect_text_boxes(frame):
            if w * h < width * height * 0.2:
                cv2.rectangle(text_hits, (x, y), (x + w, y + h), 1.0, -1)
                center_x = (x + w / 2) / width
                center_y = (y + h / 2) / height
                if center_x < 0.28 or center_x > 0.72 or center_y < 0.28 or center_y > 0.68:
                    cv2.rectangle(moving_text, (x, y), (x + w, y + h), 255, -1)

    persistent_edges = np.where(edge_hits / count >= 0.62, 255, 0).astype(np.uint8)
    persistent_edges = cv2.morphologyEx(
        persistent_edges,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (13, 7)),
    )
    persistent_text = np.where(text_hits / count >= 0.45, 255, 0).astype(np.uint8)
    persistent_text = cv2.morphologyEx(
        persistent_text,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (21, 7)),
    )

    regions = _boxes_from_mask(
        persistent_edges, width, height, "wm", "Marca d'agua persistente"
    )
    regions.extend(
        _boxes_from_mask(persistent_text, width, height, "wt", "Texto persistente")
    )
    moving_text = cv2.morphologyEx(
        moving_text,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (13, 5)),
    )
    regions.extend(
        _boxes_from_mask(moving_text, width, height, "mv", "Marca d'agua movel")
    )

    # Deduplicate highly overlapping edge/text proposals.
    deduped: List[Dict] = []
    for candidate in regions:
        cx, cy = float(candidate["x"]), float(candidate["y"])
        cw, ch = float(candidate["w"]), float(candidate["h"])
        duplicate = False
        for kept in deduped:
            kx, ky = float(kept["x"]), float(kept["y"])
            kw, kh = float(kept["w"]), float(kept["h"])
            ix = max(0.0, min(cx + cw, kx + kw) - max(cx, kx))
            iy = max(0.0, min(cy + ch, ky + kh) - max(cy, ky))
            intersection = ix * iy
            if intersection / max(1e-9, min(cw * ch, kw * kh)) > 0.72:
                duplicate = True
                break
        if not duplicate:
            deduped.append(candidate)
    return deduped
