"""Detecção de cortes de cena — máscaras nunca atravessam um corte."""
from __future__ import annotations

from typing import List, Tuple

import cv2
import numpy as np


def detect_scenes(path: str, threshold: float = 0.35, sample_scale: float = 0.25) -> List[Tuple[int, int]]:
    """Retorna [(start, end_exclusive)] por cena, em índices de frame."""
    cap = cv2.VideoCapture(path)
    cuts: List[int] = [0]
    prev_hist = None
    idx = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            small = cv2.resize(frame, (0, 0), fx=sample_scale, fy=sample_scale)
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
            cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
            if prev_hist is not None:
                d = 1.0 - float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL))
                if d > threshold and idx - cuts[-1] > 8:
                    cuts.append(idx)
            prev_hist = hist
            idx += 1
    finally:
        cap.release()

    total = idx
    cuts.append(total)
    return [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1) if cuts[i + 1] > cuts[i]]
