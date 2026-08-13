"""Pixel-accurate burned text and subtitle detection."""
from __future__ import annotations

import json
import importlib.util
import os
from typing import Any, Iterable, List, Tuple

import cv2
import numpy as np

Box = Tuple[int, int, int, int]

_detector = None
_detector_kind = "uninitialized"
_detector_tried = False


def _get_detector():
    global _detector, _detector_kind, _detector_tried
    if _detector_tried:
        return _detector
    _detector_tried = True
    try:
        # PaddleOCR 3.x direct detector. Recognition is intentionally omitted:
        # masks need geometry, not the transcription.
        from paddleocr import TextDetection  # type: ignore

        _detector = TextDetection(
            model_name=os.getenv("CLEANER_TEXT_DETECTOR", "PP-OCRv5_server_det"),
            device=os.getenv("CLEANER_OCR_DEVICE", "cpu"),
        )
        _detector_kind = "pp-ocrv5"
        return _detector
    except Exception as exc:  # pragma: no cover - optional runtime dependency
        print(f"[text_detect] modern TextDetection unavailable ({exc})")
    try:
        from paddleocr import PaddleOCR  # type: ignore

        _detector = PaddleOCR(use_angle_cls=False, lang="latin", show_log=False)
        _detector_kind = "paddleocr-legacy"
    except Exception as exc:  # pragma: no cover
        print(f"[text_detect] PaddleOCR unavailable ({exc}); using morphology")
        _detector = None
        _detector_kind = "morphology"
    return _detector


def detector_status(load: bool = False) -> dict:
    if load:
        _get_detector()
    return {
        "ready": _detector is not None or importlib.util.find_spec("paddleocr") is not None,
        "engine": _detector_kind if _detector_tried else "not-loaded",
        "model": os.getenv("CLEANER_TEXT_DETECTOR", "PP-OCRv5_server_det"),
    }


def _result_payload(item: Any) -> Any:
    if isinstance(item, dict):
        return item.get("res", item)
    data = getattr(item, "json", None)
    if callable(data):
        data = data()
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            data = None
    if isinstance(data, dict):
        return data.get("res", data)
    raw = getattr(item, "res", None)
    return raw if isinstance(raw, dict) else None


def _modern_polygons(result: Iterable[Any]) -> List[np.ndarray]:
    polygons: List[np.ndarray] = []
    for item in result or []:
        payload = _result_payload(item)
        if not isinstance(payload, dict):
            continue
        for poly in payload.get("dt_polys", []) or []:
            arr = np.asarray(poly, dtype=np.float32)
            if arr.ndim == 2 and arr.shape[0] >= 4:
                polygons.append(arr)
    return polygons


def _boxes_paddle(frame: np.ndarray) -> List[Box]:
    detector = _get_detector()
    if detector is None:
        return []
    try:
        if _detector_kind == "pp-ocrv5":
            result = detector.predict(frame, batch_size=1)
            return [cv2.boundingRect(poly.astype(np.int32)) for poly in _modern_polygons(result)]
        result = detector.ocr(frame, cls=False)
    except Exception as exc:
        print(f"[text_detect] inference failed ({exc}); using morphology for this frame")
        return []
    boxes: List[Box] = []
    for page in result or []:
        for line in page or []:
            pts = np.array(line[0], dtype=np.float32)
            boxes.append(cv2.boundingRect(pts.astype(np.int32)))
    return boxes


def _boxes_morph(frame: np.ndarray) -> List[Box]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    grad = cv2.morphologyEx(
        gray, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    connected = cv2.morphologyEx(
        bw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 5))
    )
    contours, _ = cv2.findContours(connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h_img, w_img = gray.shape[:2]
    boxes: List[Box] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w < w_img * 0.04 or h < h_img * 0.012:
            continue
        if h > h_img * 0.4 or w / max(h, 1) < 1.4:
            continue
        boxes.append((x, y, w, h))
    return boxes


def detect_text_boxes(frame: np.ndarray) -> List[Box]:
    boxes = _boxes_paddle(frame)
    return boxes if boxes else _boxes_morph(frame)


def text_pixel_mask(frame: np.ndarray, box: Box, dilate_ratio: float = 0.18) -> np.ndarray:
    """Mask glyphs, outline, shadow and glow inside a detected text box."""
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
    bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    dark = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    local = bright if bright.mean() < dark.mean() else dark
    local = cv2.bitwise_or(local, cv2.Canny(gray, 60, 160))
    kernel_size = max(3, int(round(h * dilate_ratio)) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    local = cv2.dilate(local, kernel)
    local = cv2.morphologyEx(local, cv2.MORPH_CLOSE, kernel)
    mask[y:y + h, x:x + w] = local
    return mask


def frame_text_mask(
    frame: np.ndarray,
    roi: np.ndarray | None = None,
    subtitle_only: bool = False,
) -> np.ndarray:
    h_img, w_img = frame.shape[:2]
    out = np.zeros((h_img, w_img), np.uint8)
    for box in detect_text_boxes(frame):
        x, y, w, h = box
        if subtitle_only and (y + h / 2) < h_img * 0.42:
            continue
        if roi is not None:
            sub = roi[max(0, y):y + h, max(0, x):x + w]
            if sub.size == 0 or (sub > 0).mean() < 0.15:
                continue
        out = np.maximum(out, text_pixel_mask(frame, box))
    if roi is not None:
        out = cv2.bitwise_and(out, roi)
    return out
