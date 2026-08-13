"""Subprocess adapter for the official DiffuEraser inference pipeline."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Callable, Dict, List, Optional, Tuple

from .inpainting import cuda_available


REQUIRED_CODE = ("run_diffueraser.py", "diffueraser/diffueraser.py", "propainter/inference.py")
REQUIRED_MODEL_DIRS = (
    "PCM_Weights/sd15",
)
REQUIRED_MODEL_FILES = (
    "diffuEraser/brushnet/config.json",
    "diffuEraser/brushnet/diffusion_pytorch_model.safetensors",
    "diffuEraser/unet_main/config.json",
    "diffuEraser/unet_main/diffusion_pytorch_model.safetensors",
    "PCM_Weights/sd15/pcm_sd15_smallcfg_2step_converted.safetensors",
    "stable-diffusion-v1-5/model_index.json",
    "sd-vae-ft-mse/config.json",
    "sd-vae-ft-mse/diffusion_pytorch_model.safetensors",
)
PROPAINTER_WEIGHTS = ("ProPainter.pth", "recurrent_flow_completion.pth", "raft-things.pth")


class DiffuEraserUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class DiffuEraserStatus:
    ready: bool
    root: str
    models_root: str
    cuda: bool
    missing: Tuple[str, ...]
    license: str = "Apache-2.0; bundled ProPainter prior retains its non-commercial license"

    def as_dict(self) -> Dict[str, object]:
        return asdict(self)


def diffueraser_root() -> Path:
    configured = os.getenv("DIFFUERASER_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(__file__).resolve().parents[2] / "vendor" / "DiffuEraser").resolve()


def models_root() -> Path:
    configured = os.getenv("DIFFUERASER_MODELS_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return (diffueraser_root() / "weights").resolve()


def diffueraser_status() -> DiffuEraserStatus:
    root = diffueraser_root()
    models = models_root()
    missing: List[str] = []
    for relative in REQUIRED_CODE:
        if not (root / relative).is_file():
            missing.append(relative)
    for relative in REQUIRED_MODEL_DIRS:
        directory = models / relative
        if not directory.is_dir() or not any(
            path.is_file() and path.stat().st_size > 1024
            for path in directory.rglob("*")
        ):
            missing.append(f"models/{relative}")
    for relative in REQUIRED_MODEL_FILES:
        path = models / relative
        if not path.is_file() or path.stat().st_size < 100:
            missing.append(f"models/{relative}")
    for name in PROPAINTER_WEIGHTS:
        path = models / "propainter" / name
        if not path.is_file() or path.stat().st_size < 1024 * 1024:
            missing.append(f"models/propainter/{name}")
    has_cuda = cuda_available()
    if not has_cuda:
        missing.append("cuda")
    return DiffuEraserStatus(not missing, str(root), str(models), has_cuda, tuple(missing))


def build_diffueraser_command(
    input_video: str,
    mask_video: str,
    output_dir: str,
    duration: float,
) -> List[str]:
    root = diffueraser_root()
    models = models_root()
    max_side = max(320, int(os.getenv("DIFFUERASER_MAX_SIDE", "960")))
    return [
        os.getenv("DIFFUERASER_PYTHON", sys.executable),
        str(root / "run_diffueraser.py"),
        "--input_video", str(Path(input_video).resolve()),
        "--input_mask", str(Path(mask_video).resolve()),
        "--video_length", str(max(1, math.ceil(duration))),
        "--mask_dilation_iter", os.getenv("DIFFUERASER_MASK_DILATION", "4"),
        "--max_img_size", str(max_side),
        "--save_path", str(Path(output_dir).resolve()),
        "--ref_stride", "5",
        "--neighbor_length", "12",
        "--subvideo_length", "50",
        "--base_model_path", str(models / "stable-diffusion-v1-5"),
        "--vae_path", str(models / "sd-vae-ft-mse"),
        "--diffueraser_path", str(models / "diffuEraser"),
        "--propainter_model_dir", str(models / "propainter"),
    ]


def _link_model_tree(root: Path, models: Path) -> None:
    expected = root / "weights"
    expected.mkdir(parents=True, exist_ok=True)
    top_levels = {
        relative.split("/", 1)[0]
        for relative in (*REQUIRED_MODEL_DIRS, *REQUIRED_MODEL_FILES)
    }
    top_levels.add("propainter")
    for top_level in top_levels:
        source = models / top_level
        destination = expected / top_level
        if destination.exists() or destination.is_symlink():
            continue
        try:
            destination.symlink_to(source, target_is_directory=True)
        except OSError:
            shutil.copytree(source, destination)


def run_diffueraser(
    input_video: str,
    mask_video: str,
    output_dir: str,
    duration: float,
    on_stage: Optional[Callable[[str], None]] = None,
    cancel_file: Optional[str] = None,
) -> str:
    status = diffueraser_status()
    if not status.ready:
        raise DiffuEraserUnavailable(
            "DiffuEraser oficial indisponivel: " + ", ".join(status.missing)
        )
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    output = target / "diffueraser_result.mp4"
    log_path = target / "diffueraser.log"
    if output.exists():
        output.unlink()
    command = build_diffueraser_command(input_video, mask_video, output_dir, duration)
    _link_model_tree(Path(status.root), Path(status.models_root))
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (status.root, env.get("PYTHONPATH", "")) if part
    )
    if on_stage:
        on_stage("DiffuEraser oficial (difusao temporal + prior ProPainter)")
    timeout = max(600, int(os.getenv("DIFFUERASER_TIMEOUT_SECONDS", "21600")))
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            command,
            cwd=status.root,
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
                raise TimeoutError("DiffuEraser excedeu o tempo limite")
            time.sleep(1)
        returncode = process.returncode
    if returncode != 0:
        tail = "\n".join(
            log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-20:]
        )
        raise RuntimeError(f"DiffuEraser falhou (codigo {returncode}).\n{tail}")
    if not output.is_file() or output.stat().st_size < 1024:
        raise RuntimeError(f"DiffuEraser concluiu sem resultado; log: {log_path}")
    return str(output)
