"""Localização de pixels de texto (legenda / texto queimado).

O objetivo não é ler palavras: é achar exatamente onde estão os pixels de
letra, stroke, sombra e glow, para a máscara cobrir tudo isso.
Usa PaddleOCR (DBNet) quando disponível; caso contrário cai num detector
morfológico (MSER + gradiente) que também devolve caixas de texto.
"""
from __future__ import annotations

from typing import List, Tuple

import cv2
import numpy as np

Box = Tuple[int, int, int, int]  # x, y, w, h

_ocr = None
_ocr_tried = False


def _get_ocr():
    global _ocr, _ocr_tried
    if _ocr_tried:
        return _ocr
    _ocr_tried = True
    try:
        from paddleocr import PaddleOCR  # type: ignore

        _ocr = PaddleOCR(use_angle_cls=False, lang="latin", show_log=False)
    except Exception as exc:  # pragma: no cover - depende do ambiente GPU
        print(f"[text_detect] PaddleOCR indisponível ({exc}); usando fallback morfológico")
        _ocr = None
    return _ocr


def _boxes_paddle(frame: np.ndarray) -> List[Box]:
    ocr = _get_ocr()
    if ocr is None:
        return []
    try:
        result = ocr.ocr(frame, cls=False)
    except Exception:
        return []
    boxes: List[Box] = []
    for page in result or []:
        for line in page or []:
            pts = np.array(line[0], dtype=np.float32)
            x, y, w, h = cv2.boundingRect(pts.astype(np.int32))
            boxes.append((x, y, w, h))
    return boxes


def _boxes_morph(frame: np.ndarray) -> List[Box]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    connected = cv2.morphologyEx(bw, cv2.MORPH_CLOSE,
                                 cv2.getStructuringElement(cv2.MORPH_RECT, (17, 5)))
    contours, _ = cv2.findContours(connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h_img, w_img = gray.shape[:2]
    boxes: List[Box] = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w < w_img * 0.04 or h < h_img * 0.012:
            continue
        if h > h_img * 0.4:
            continue
        if w / max(h, 1) < 1.4:
            continue
        boxes.append((x, y, w, h))
    return boxes


def detect_text_boxes(frame: np.ndarray) -> List[Box]:
    boxes = _boxes_paddle(frame)
    return boxes if boxes else _boxes_morph(frame)


def text_pixel_mask(frame: np.ndarray, box: Box, dilate_ratio: float = 0.18) -> np.ndarray:
    """Máscara em nível de pixel dentro da caixa: letra + stroke + sombra + glow."""
    h_img, w_img = frame.shape[:2]
    x, y, w, h = box
    x, y = max(0, x), max(0, y)
    w, h = min(w_img - x, w), min(h_img - y, h)
    mask = np.zeros((h_img, w_img), dtype=np.uint8)
    if w <= 2 or h <= 2:
        return mask

    roi = frame[y:y + h, x:x + w]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 5, 40, 40)

    # legenda costuma ser muito clara ou muito escura em relação ao fundo local
    bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    dark = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    local = bright if bright.mean() < dark.mean() else dark

    edges = cv2.Canny(gray, 60, 160)
    local = cv2.bitwise_or(local, edges)

    # dilatação adaptativa proporcional à altura do texto (pega stroke/sombra)
    k = max(3, int(round(h * dilate_ratio)) | 1)
    local = cv2.dilate(local, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    local = cv2.morphologyEx(local, cv2.MORPH_CLOSE,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))

    mask[y:y + h, x:x + w] = local
    return mask


def frame_text_mask(
    frame: np.ndarray,
    roi: np.ndarray | None = None,
    subtitle_only: bool = False,
) -> np.ndarray:
    """Máscara de pixels de texto do frame inteiro (letra + stroke + sombra).

    Usada na varredura temporal: cada frame recebe a SUA máscara, então
    legenda karaokê/dinâmica é acompanhada palavra a palavra.
    """
    h_img, w_img = frame.shape[:2]
    out = np.zeros((h_img, w_img), np.uint8)
    for box in detect_text_boxes(frame):
        x, y, w, h = box
        if subtitle_only and (y + h / 2) < h_img * 0.42:
            continue
        if roi is not None:
            sub = roi[max(0, y):y + h, max(0, x):x + w]
            if sub.size == 0 or (sub > 0).mean() < 0.25:
                continue
        out = np.maximum(out, text_pixel_mask(frame, box))
    return out
