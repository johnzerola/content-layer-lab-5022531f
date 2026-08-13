"""Local temporal restoration used only by the explicit fast/fallback mode."""
from __future__ import annotations

import gc
from typing import List, Optional

import cv2
import numpy as np

try:
    import torch
except Exception:  # pragma: no cover
    torch = None  # type: ignore


def cuda_available() -> bool:
    return bool(torch and torch.cuda.is_available())


def device_name() -> str:
    if cuda_available():
        return torch.cuda.get_device_name(0)  # type: ignore[union-attr]
    return "cpu"


def empty_cache() -> None:
    if cuda_available():
        torch.cuda.empty_cache()  # type: ignore[union-attr]
    gc.collect()


def patch_fill(image: np.ndarray, hole: np.ndarray, patch: int = 13, search: int = 96) -> np.ndarray:
    """Exemplar fill for pixels with no usable temporal reference."""
    if hole.max() == 0:
        return image
    height, width = hole.shape[:2]
    out = image.copy()
    remaining = (hole > 0).astype(np.uint8) * 255
    seed = cv2.inpaint(out, remaining, 3, cv2.INPAINT_TELEA)
    out[remaining > 0] = seed[remaining > 0]
    step = max(4, patch // 2)
    ys, xs = np.where(remaining > 0)
    if ys.size == 0:
        return out
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    half = patch // 2
    for block_y in range(y0, y1 + 1, step):
        for block_x in range(x0, x1 + 1, step):
            if remaining[block_y:block_y + step, block_x:block_x + step].max() == 0:
                continue
            target_y0, target_x0 = max(0, block_y - half), max(0, block_x - half)
            target_y1 = min(height, block_y + step + half)
            target_x1 = min(width, block_x + step + half)
            template = out[target_y0:target_y1, target_x0:target_x1]
            template_mask = (
                remaining[target_y0:target_y1, target_x0:target_x1] == 0
            ).astype(np.uint8) * 255
            if template.shape[0] < 5 or template.shape[1] < 5 or template_mask.max() == 0:
                continue
            source_y0, source_x0 = max(0, target_y0 - search), max(0, target_x0 - search)
            source_y1, source_x1 = min(height, target_y1 + search), min(width, target_x1 + search)
            source = out[source_y0:source_y1, source_x0:source_x1]
            source_hole = remaining[source_y0:source_y1, source_x0:source_x1]
            if source.shape[0] <= template.shape[0] or source.shape[1] <= template.shape[1]:
                continue
            try:
                scores = cv2.matchTemplate(
                    source, template, cv2.TM_CCORR_NORMED, mask=template_mask
                )
            except Exception:
                continue
            scores[~np.isfinite(scores)] = -1.0
            occupied = cv2.boxFilter(
                (source_hole > 0).astype(np.float32),
                -1,
                (template.shape[1], template.shape[0]),
                normalize=True,
            )
            scores[occupied[:scores.shape[0], :scores.shape[1]] > 0.02] = -1.0
            _, best_score, _, best = cv2.minMaxLoc(scores)
            if best_score <= 0:
                continue
            candidate = source[
                best[1]:best[1] + template.shape[0],
                best[0]:best[0] + template.shape[1],
            ]
            if candidate.shape != template.shape:
                continue
            fill = remaining[target_y0:target_y1, target_x0:target_x1] > 0
            target = out[target_y0:target_y1, target_x0:target_x1]
            target[fill] = candidate[fill]
            out[target_y0:target_y1, target_x0:target_x1] = target
            remaining[block_y:block_y + step, block_x:block_x + step] = 0
    if remaining.max() > 0:
        rest = cv2.inpaint(out, remaining, 3, cv2.INPAINT_TELEA)
        out[remaining > 0] = rest[remaining > 0]
    return out


class InpaintingEngine:
    name = "base"

    def process(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:
        raise NotImplementedError


class TemporalFillEngine(InpaintingEngine):
    """Align neighboring frames and copy real background pixels into holes."""

    name = "temporal-fill"

    def __init__(self, context_radius: int = 12):
        self.context_radius = context_radius

    def process(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:
        count = len(frames)
        grays = [cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) for frame in frames]
        output = [frame.copy() for frame in frames]
        for index in range(count):
            remaining = masks[index].copy()
            if remaining.max() == 0:
                continue
            current = output[index]
            for radius in range(1, self.context_radius + 1):
                for neighbor in (index - radius, index + radius):
                    if neighbor < 0 or neighbor >= count or remaining.max() == 0:
                        continue
                    flow = cv2.calcOpticalFlowFarneback(
                        grays[index], grays[neighbor], None, 0.5, 3, 25, 3, 5, 1.2, 0
                    )
                    height, width = grays[index].shape
                    grid_x, grid_y = np.meshgrid(
                        np.arange(width, dtype=np.float32),
                        np.arange(height, dtype=np.float32),
                    )
                    warped = cv2.remap(
                        frames[neighbor],
                        grid_x + flow[..., 0],
                        grid_y + flow[..., 1],
                        cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_REPLICATE,
                    )
                    warped_mask = cv2.remap(
                        masks[neighbor],
                        grid_x + flow[..., 0],
                        grid_y + flow[..., 1],
                        cv2.INTER_NEAREST,
                        borderMode=cv2.BORDER_CONSTANT,
                    )
                    usable = cv2.bitwise_and(remaining, cv2.bitwise_not(warped_mask))
                    selected = usable > 0
                    current[selected] = warped[selected]
                    remaining[selected] = 0
            if remaining.max() > 0:
                current = patch_fill(current, remaining)
            output[index] = current
        return np.asarray(output)


def process_windowed(
    engine: InpaintingEngine,
    frames: List[np.ndarray],
    masks: np.ndarray,
    chunk: int = 80,
    overlap: int = 16,
    on_progress=None,
) -> List[np.ndarray]:
    total = len(frames)
    output: List[Optional[np.ndarray]] = [None] * total
    start = 0
    while start < total:
        end = min(total, start + chunk)
        context_start = max(0, start - overlap)
        context_end = min(total, end + overlap)
        result = engine.process(
            np.asarray(frames[context_start:context_end]), masks[context_start:context_end]
        )
        for index in range(start, end):
            output[index] = result[index - context_start]
        if on_progress:
            on_progress(end / total)
        start = end
    return [frame if frame is not None else frames[index] for index, frame in enumerate(output)]
