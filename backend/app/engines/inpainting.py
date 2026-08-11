"""Motores de video inpainting.

Regra do produto: reconstruir o fundo usando contexto temporal (frames
anteriores e posteriores). Nunca borrar, pixelizar ou cobrir a área.
"""
from __future__ import annotations

import gc
import os
from typing import List, Optional

import cv2
import numpy as np

try:  # torch é opcional em ambiente de dev sem GPU
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


class InpaintingEngine:
    """Interface comum a todos os motores."""

    name = "base"
    context_radius = 10

    def process(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:
        """frames (T,H,W,C) uint8; masks (T,H,W) uint8 0/255 -> (T,H,W,C) uint8."""
        raise NotImplementedError


class TemporalFillEngine(InpaintingEngine):
    """Reconstrução temporal pura (sem pesos): busca o pixel real do fundo em
    frames vizinhos onde a área não estava ocluída, alinhando por optical flow.
    É o caminho usado quando os pesos neurais não estão presentes — continua
    reconstruindo conteúdo real, nunca borrando."""

    name = "temporal-fill"

    def __init__(self, context_radius: int = 12):
        self.context_radius = context_radius

    def process(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:
        t = len(frames)
        grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
        out = [f.copy() for f in frames]

        for i in range(t):
            hole = masks[i]
            if hole.max() == 0:
                continue
            remaining = hole.copy()
            acc = out[i]
            for radius in range(1, self.context_radius + 1):
                for j in (i - radius, i + radius):
                    if j < 0 or j >= t or remaining.max() == 0:
                        continue
                    flow = cv2.calcOpticalFlowFarneback(grays[i], grays[j], None,
                                                        0.5, 3, 25, 3, 5, 1.2, 0)
                    h, w = grays[i].shape
                    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32),
                                         np.arange(h, dtype=np.float32))
                    warped = cv2.remap(frames[j], gx + flow[..., 0], gy + flow[..., 1],
                                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                    warped_mask = cv2.remap(masks[j], gx + flow[..., 0], gy + flow[..., 1],
                                            cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
                    usable = cv2.bitwise_and(remaining, cv2.bitwise_not(warped_mask))
                    if usable.max() == 0:
                        continue
                    idx = usable > 0
                    acc[idx] = warped[idx]
                    remaining[idx] = 0
            if remaining.max() > 0:
                # resto sem referência temporal: síntese espacial coerente
                acc = cv2.inpaint(acc, remaining, 7, cv2.INPAINT_NS)
            out[i] = acc
        return np.array(out)


class _WeightedNeuralEngine(InpaintingEngine):
    """Base para motores neurais com pesos em disco. Se os pesos não existirem,
    delega para TemporalFillEngine (mesmo contrato, sem blur)."""

    weights_env = ""
    default_weights = ""

    def __init__(self, context_radius: int = 10, fp16: bool = True):
        self.context_radius = context_radius
        self.fp16 = fp16 and cuda_available()
        self.model = None
        self.weights = os.getenv(self.weights_env, self.default_weights)
        self._fallback: Optional[TemporalFillEngine] = None

    def _load(self) -> bool:
        if self.model is not None:
            return True
        if not self.weights or not os.path.exists(self.weights):
            return False
        try:
            self.model = self._build()
            return self.model is not None
        except Exception as exc:  # pragma: no cover
            print(f"[{self.name}] falha ao carregar pesos: {exc}")
            self.model = None
            return False

    def _build(self):  # pragma: no cover - depende dos pesos
        raise NotImplementedError

    def _infer(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def process(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:
        if self._load():
            try:
                return self._infer(frames, masks)
            except RuntimeError as exc:  # OOM tratado pelo chamador
                if "out of memory" in str(exc).lower():
                    raise
                print(f"[{self.name}] erro na inferência: {exc}")
        if self._fallback is None:
            self._fallback = TemporalFillEngine(self.context_radius)
        return self._fallback.process(frames, masks)


class ProPainterEngine(_WeightedNeuralEngine):
    """Motor principal: propagação de fluxo + transformer temporal."""

    name = "propainter"
    weights_env = "PROPAINTER_WEIGHTS"
    default_weights = "models/ProPainter.pth"

    def _build(self):  # pragma: no cover - requer repositório ProPainter
        from model.propainter import InpaintGenerator  # type: ignore

        net = InpaintGenerator()
        state = torch.load(self.weights, map_location="cpu")  # type: ignore[union-attr]
        net.load_state_dict(state, strict=False)
        net = net.to("cuda" if cuda_available() else "cpu").eval()
        if self.fp16:
            net = net.half()
        return net

    @torch.no_grad() if torch else (lambda f: f)  # type: ignore[misc]
    def _infer(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:  # pragma: no cover
        dev = "cuda" if cuda_available() else "cpu"
        dtype = torch.float16 if self.fp16 else torch.float32  # type: ignore[union-attr]
        f = torch.from_numpy(frames[..., ::-1].copy()).permute(0, 3, 1, 2)  # type: ignore[union-attr]
        f = (f.to(dev, dtype) / 127.5) - 1.0
        m = torch.from_numpy(masks).unsqueeze(1).to(dev, dtype) / 255.0  # type: ignore[union-attr]
        pred = self.model(f.unsqueeze(0), m.unsqueeze(0))  # type: ignore[misc]
        pred = pred.squeeze(0).float().clamp(-1, 1)
        out = ((pred + 1.0) * 127.5).permute(0, 2, 3, 1).cpu().numpy().astype(np.uint8)
        out = out[..., ::-1]
        keep = masks[..., None] == 0
        return np.where(keep, frames, out)


class STTNEngine(_WeightedNeuralEngine):
    """Rápido: Spatial-Temporal Transformer Network."""

    name = "sttn"
    weights_env = "STTN_WEIGHTS"
    default_weights = "models/sttn.pth"

    def __init__(self):
        super().__init__(context_radius=6)

    def _build(self):  # pragma: no cover
        from model.sttn import InpaintGenerator  # type: ignore

        net = InpaintGenerator()
        net.load_state_dict(torch.load(self.weights, map_location="cpu"), strict=False)  # type: ignore[union-attr]
        return net.to("cuda" if cuda_available() else "cpu").eval()

    def _infer(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:  # pragma: no cover
        return ProPainterEngine._infer(self, frames, masks)  # mesmo formato de I/O


class LamaEngine(_WeightedNeuralEngine):
    """Espacial (LaMa) — usado para resíduos sem referência temporal."""

    name = "lama"
    weights_env = "LAMA_WEIGHTS"
    default_weights = "models/big-lama.pt"

    def _build(self):  # pragma: no cover
        return torch.jit.load(self.weights, map_location="cuda" if cuda_available() else "cpu").eval()  # type: ignore[union-attr]

    def _infer(self, frames: np.ndarray, masks: np.ndarray) -> np.ndarray:  # pragma: no cover
        out = []
        dev = "cuda" if cuda_available() else "cpu"
        for frame, mask in zip(frames, masks):
            x = torch.from_numpy(frame[..., ::-1].copy()).permute(2, 0, 1).float().to(dev) / 255.0  # type: ignore[union-attr]
            m = torch.from_numpy(mask).unsqueeze(0).float().to(dev) / 255.0  # type: ignore[union-attr]
            y = self.model(x.unsqueeze(0), m.unsqueeze(0))[0]  # type: ignore[misc]
            arr = (y.clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)[..., ::-1]
            out.append(np.where(mask[..., None] == 0, frame, arr))
        return np.array(out)


PRESETS = {
    "fast": ("sttn", 1),
    "quality": ("propainter", 1),
    "max": ("propainter", 2),
}


def build_engine(preset: str) -> InpaintingEngine:
    name, _ = PRESETS.get(preset, PRESETS["quality"])
    if name == "sttn":
        return STTNEngine()
    return ProPainterEngine(context_radius=16 if preset == "max" else 10)


def passes_for(preset: str) -> int:
    return PRESETS.get(preset, PRESETS["quality"])[1]


def process_windowed(
    engine: InpaintingEngine,
    frames: List[np.ndarray],
    masks: np.ndarray,
    chunk: int = 80,
    overlap: int = 16,
    on_progress=None,
) -> List[np.ndarray]:
    """Janelas temporais com overlap. Nunca carrega o vídeo inteiro na GPU.
    Em CUDA OOM: reduz o chunk, limpa o cache e tenta de novo."""
    total = len(frames)
    out: List[Optional[np.ndarray]] = [None] * total
    start = 0
    size = chunk

    while start < total:
        end = min(total, start + size)
        ctx_a = max(0, start - overlap)
        ctx_b = min(total, end + overlap)
        block = np.array(frames[ctx_a:ctx_b])
        block_masks = masks[ctx_a:ctx_b]
        try:
            result = engine.process(block, block_masks)
        except RuntimeError as exc:
            if "out of memory" in str(exc).lower() and size > 8:
                empty_cache()
                size = max(8, size // 2)
                print(f"[inpaint] CUDA OOM — reduzindo chunk para {size}")
                continue
            raise
        for i in range(start, end):
            out[i] = result[i - ctx_a]
        if on_progress:
            on_progress(end / total)
        empty_cache()
        start = end

    return [f if f is not None else frames[i] for i, f in enumerate(out)]
