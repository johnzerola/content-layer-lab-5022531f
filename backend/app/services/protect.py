"""Máscara de proteção automática: rosto / pessoa.

Se a legenda ou o logo encostam no sujeito, o motor de inpainting não pode
reconstruir por cima dele — isso é o que produz rosto derretido. Aqui geramos
uma máscara do que NÃO pode ser tocado; o pipeline subtrai ela da máscara de
remoção.
"""
from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np

_face_cascade = None
_face_tried = False
_selfie = None
_selfie_tried = False


def _get_face():
    global _face_cascade, _face_tried
    if _face_tried:
        return _face_cascade
    _face_tried = True
    try:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"  # type: ignore[attr-defined]
        cascade = cv2.CascadeClassifier(path)
        _face_cascade = None if cascade.empty() else cascade
    except Exception as exc:  # pragma: no cover
        print(f"[protect] cascade indisponível ({exc})")
        _face_cascade = None
    return _face_cascade


def _get_selfie():
    global _selfie, _selfie_tried
    if _selfie_tried:
        return _selfie
    _selfie_tried = True
    try:  # pragma: no cover - depende do ambiente
        import mediapipe as mp  # type: ignore

        _selfie = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
    except Exception as exc:
        print(f"[protect] mediapipe indisponível ({exc}); usando somente rosto")
        _selfie = None
    return _selfie


def person_mask(frame: np.ndarray) -> np.ndarray:
    """Pixels ocupados por pessoa/rosto no frame."""
    h, w = frame.shape[:2]
    mask = np.zeros((h, w), np.uint8)

    seg = _get_selfie()
    if seg is not None:  # pragma: no cover - depende do ambiente
        try:
            res = seg.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if res.segmentation_mask is not None:
                mask = np.where(res.segmentation_mask > 0.6, 255, 0).astype(np.uint8)
        except Exception:
            mask = np.zeros((h, w), np.uint8)

    cascade = _get_face()
    if cascade is not None:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        try:
            faces = cascade.detectMultiScale(gray, 1.15, 5, minSize=(int(w * 0.06), int(h * 0.06)))
        except Exception:
            faces = []
        for (x, y, fw, fh) in faces:
            cv2.ellipse(mask, (int(x + fw / 2), int(y + fh / 2)),
                        (int(fw * 0.72), int(fh * 0.9)), 0, 0, 360, 255, -1)

    if mask.max() > 0:
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    return mask


def sampled_protect_mask(frames: List[np.ndarray], step: int = 4) -> Optional[np.ndarray]:
    """União da máscara de pessoa em frames amostrados de uma janela."""
    acc: Optional[np.ndarray] = None
    for i in range(0, len(frames), max(1, step)):
        m = person_mask(frames[i])
        if m.max() == 0:
            continue
        acc = m if acc is None else np.maximum(acc, m)
    return acc
