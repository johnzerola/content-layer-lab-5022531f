"""Tracking temporal da máscara por optical flow (Farneback).

Objetivo: a máscara não pisca nem muda de tamanho sozinha. Se a legenda se
move, a máscara acompanha; se fica parada, ela é estabilizada.
"""
from __future__ import annotations

from typing import List, Sequence, Tuple

import cv2
import numpy as np


def _warp(mask: np.ndarray, flow: np.ndarray) -> np.ndarray:
    h, w = mask.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    map_x = grid_x + flow[..., 0]
    map_y = grid_y + flow[..., 1]
    return cv2.remap(mask, map_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)


def propagate(
    frames: Sequence[np.ndarray],
    seed_mask: np.ndarray,
    seed_index: int = 0,
) -> List[np.ndarray]:
    """Propaga uma máscara para frente e para trás dentro de uma cena."""
    n = len(frames)
    out: List[np.ndarray] = [np.zeros_like(seed_mask) for _ in range(n)]
    out[seed_index] = seed_mask.copy()
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]

    for i in range(seed_index + 1, n):
        flow = cv2.calcOpticalFlowFarneback(grays[i], grays[i - 1], None,
                                            0.5, 3, 21, 3, 5, 1.2, 0)
        out[i] = _warp(out[i - 1], flow)

    for i in range(seed_index - 1, -1, -1):
        flow = cv2.calcOpticalFlowFarneback(grays[i], grays[i + 1], None,
                                            0.5, 3, 21, 3, 5, 1.2, 0)
        out[i] = _warp(out[i + 1], flow)

    return out


def stabilize(masks: np.ndarray, window: int = 5, motion_thresh: float = 0.02) -> np.ndarray:
    """Suaviza a máscara no tempo: dissolve piscadas e prende regiões estáticas."""
    t = len(masks)
    if t < 3:
        return masks
    out = masks.copy()
    half = max(1, window // 2)
    for i in range(t):
        lo, hi = max(0, i - half), min(t, i + half + 1)
        stack = masks[lo:hi].astype(np.float32) / 255.0
        avg = stack.mean(axis=0)
        keep = (avg >= 0.5) | (masks[i] > 0) & (avg >= 0.3)
        out[i] = np.where(keep, 255, 0).astype(np.uint8)

    # se o conteúdo é praticamente estático, congela a união (evita respirar)
    diffs = [float(np.mean(np.abs(masks[i].astype(np.int16) - masks[i - 1].astype(np.int16))) / 255.0)
             for i in range(1, t)]
    if diffs and float(np.mean(diffs)) < motion_thresh:
        union = np.max(masks, axis=0)
        out[:] = union[None, ...]
    return out


def static_regions(path_frames: Sequence[np.ndarray], min_ratio: float = 0.7) -> np.ndarray:
    """Pixels que quase não mudam ao longo do tempo — típico de watermark fixa."""
    if not path_frames:
        return np.zeros((1, 1), np.uint8)
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in path_frames]
    stack = np.stack(grays, axis=0)
    std = stack.std(axis=0)
    edges = np.mean([cv2.Canny(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), 80, 200).astype(np.float32) / 255.0
                     for f in path_frames], axis=0)
    static = ((std < 6.0) & (edges > (1.0 - min_ratio))).astype(np.uint8) * 255
    return cv2.morphologyEx(static, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (15, 9)))
