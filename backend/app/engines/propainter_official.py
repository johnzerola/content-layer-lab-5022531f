"""Adapter for the complete official ProPainter inference pipeline.

The upstream project is intentionally executed as a subprocess. ProPainter is
not only ``InpaintGenerator``: it also uses RAFT and recurrent flow completion.
Keeping the upstream runner intact avoids silently shipping a partial model.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Callable, Dict, List, Optional, Tuple

from .inpainting import cuda_available


REQUIRED_CODE = (
    "inference_propainter.py",
    "model/propainter.py",
    "model/recurrent_flow_completion.py",
    "RAFT/core/raft.py",
)
REQUIRED_WEIGHTS = (
    "ProPainter.pth",
    "recurrent_flow_completion.pth",
    "raft-things.pth",
)


class ProPainterUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class ProPainterStatus:
    ready: bool
    root: str
    cuda: bool
    missing: Tuple[str, ...]
    license: str = "NTU S-Lab License 1.0 (non-commercial unless authorized)"

    def as_dict(self) -> Dict[str, object]:
        return asdict(self)


def propainter_root() -> Path:
    configured = os.getenv("PROPAINTER_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    bundled = Path(__file__).resolve().parents[2] / "vendor" / "ProPainter"
    return bundled.resolve()


def propainter_status(require_cuda: bool = True) -> ProPainterStatus:
    root = propainter_root()
    weights_dir = Path(os.getenv("PROPAINTER_WEIGHTS_DIR", str(root / "weights")))
    missing: List[str] = []
    for rel in REQUIRED_CODE:
        if not (root / rel).is_file():
            missing.append(rel)
    for name in REQUIRED_WEIGHTS:
        path = weights_dir / name
        if not path.is_file() or path.stat().st_size < 1024 * 1024:
            missing.append(f"weights/{name}")
    has_cuda = cuda_available()
    if require_cuda and not has_cuda:
        missing.append("cuda")
    return ProPainterStatus(not missing, str(root), has_cuda, tuple(missing))


def _processing_size(width: int, height: int, preset: str) -> Tuple[int, int]:
    default_side = 1280 if preset == "max" else 960
    max_side = max(320, int(os.getenv("PROPAINTER_MAX_SIDE", str(default_side))))
    scale = min(1.0, max_side / float(max(width, height)))
    out_w = max(8, int(width * scale) // 8 * 8)
    out_h = max(8, int(height * scale) // 8 * 8)
    return out_w, out_h


def build_propainter_command(
    input_video: str,
    mask_dir: str,
    output_dir: str,
    width: int,
    height: int,
    fps: float,
    preset: str,
) -> List[str]:
    root = propainter_root()
    proc_w, proc_h = _processing_size(width, height, preset)
    command = [
        os.getenv("PROPAINTER_PYTHON", sys.executable),
        str(root / "inference_propainter.py"),
        "--video", str(Path(input_video).resolve()),
        "--mask", str(Path(mask_dir).resolve()),
        "--output", str(Path(output_dir).resolve()),
        "--width", str(proc_w),
        "--height", str(proc_h),
        "--save_fps", str(max(1, round(fps))),
        "--subvideo_length", "80" if preset == "max" else "64",
        "--neighbor_length", "12" if preset == "max" else "10",
        "--ref_stride", "5" if preset == "max" else "10",
        "--mask_dilation", "2" if preset == "max" else "1",
    ]
    if cuda_available() and os.getenv("PROPAINTER_FP16", "1") == "1":
        command.append("--fp16")
    return command


def run_propainter(
    input_video: str,
    mask_dir: str,
    output_dir: str,
    width: int,
    height: int,
    fps: float,
    preset: str,
    on_stage: Optional[Callable[[str], None]] = None,
    cancel_file: Optional[str] = None,
) -> str:
    status = propainter_status(require_cuda=os.getenv("PROPAINTER_ALLOW_CPU", "0") != "1")
    if not status.ready:
        raise ProPainterUnavailable(
            "ProPainter oficial indisponivel: " + ", ".join(status.missing)
        )

    root = Path(status.root)
    target = Path(output_dir)
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    log_path = target / "propainter.log"
    command = build_propainter_command(
        input_video, mask_dir, output_dir, width, height, fps, preset
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(root), env.get("PYTHONPATH", "")) if part
    )
    weights_dir = Path(os.getenv("PROPAINTER_WEIGHTS_DIR", str(root / "weights"))).resolve()

    # Upstream resolves weights relative to its own root. A custom mounted
    # directory is linked into that expected location without copying GBs.
    expected_weights = root / "weights"
    if weights_dir != expected_weights.resolve():
        expected_weights.mkdir(parents=True, exist_ok=True)
        for name in REQUIRED_WEIGHTS:
            source = weights_dir / name
            destination = expected_weights / name
            if not destination.exists():
                try:
                    destination.symlink_to(source)
                except OSError:
                    shutil.copy2(source, destination)

    if on_stage:
        on_stage(f"ProPainter oficial {command[command.index('--width') + 1]}x{command[command.index('--height') + 1]}")
    timeout = max(300, int(os.getenv("PROPAINTER_TIMEOUT_SECONDS", "10800")))
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            command,
            cwd=root,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            if cancel_file and Path(cancel_file).exists():
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise RuntimeError("job cancelado")
            if time.monotonic() >= deadline:
                process.kill()
                raise TimeoutError("ProPainter excedeu o tempo limite")
            time.sleep(1)
        returncode = process.returncode
    if returncode != 0:
        tail = ""
        try:
            tail = "\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-20:])
        except OSError:
            pass
        raise RuntimeError(f"ProPainter falhou (codigo {returncode}).\n{tail}")

    candidates = sorted(target.rglob("inpaint_out.mp4"))
    if not candidates:
        raise RuntimeError(f"ProPainter concluiu sem gerar inpaint_out.mp4; log: {log_path}")
    return str(candidates[0])
