#!/usr/bin/env python3
"""Install pinned DiffuEraser code and all official inference model folders."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys

from huggingface_hub import snapshot_download

from install_propainter import install_weights


REPOSITORY = "https://github.com/lixiaowen-xw/DiffuEraser.git"
PINNED_COMMIT = "8e6f279ac7531e27ad1849c6f8dab5372a8597e7"
MODEL_REVISIONS = {
    "lixiaowen/diffuEraser": "ad510dca07fa8e155d4bd8d002085bb8ec8f60e5",
    "stable-diffusion-v1-5/stable-diffusion-v1-5": "451f4fe16113bff5a5d2269ed5ad43b0592e9a14",
    "wangfuyun/PCM_Weights": "39560fead4ce00f94db3cb8e93dd8fba90ec0be6",
    "stabilityai/sd-vae-ft-mse": "31f26fdeee1355a5c34592e401dd41e45d25a493",
}


def install_code(root: Path) -> None:
    if (root / "run_diffueraser.py").is_file():
        print(f"[ok] DiffuEraser code already present: {root}")
        return
    if root.exists() and any(root.iterdir()):
        raise RuntimeError(f"refusing to overwrite non-empty directory: {root}")
    root.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--no-checkout", REPOSITORY, str(root)], check=True)
    subprocess.run(["git", "checkout", PINNED_COMMIT], cwd=root, check=True)


def hf_download(repo: str, destination: Path, allow_patterns=None) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    print(f"[download] {repo} -> {destination}")
    snapshot_download(
        repo_id=repo,
        revision=MODEL_REVISIONS[repo],
        local_dir=destination,
        allow_patterns=allow_patterns,
        token=os.getenv("HF_TOKEN") or None,
    )


def install_models(models: Path) -> None:
    hf_download(
        "lixiaowen/diffuEraser",
        models / "diffuEraser",
        ["brushnet/*.json", "brushnet/*.safetensors", "unet_main/*.json", "unet_main/*.safetensors"],
    )
    hf_download(
        "stable-diffusion-v1-5/stable-diffusion-v1-5",
        models / "stable-diffusion-v1-5",
        [
            "feature_extractor/*",
            "model_index.json",
            "safety_checker/*.json",
            "safety_checker/*.safetensors",
            "scheduler/*",
            "text_encoder/*.json",
            "text_encoder/*.safetensors",
            "tokenizer/*",
        ],
    )
    hf_download(
        "wangfuyun/PCM_Weights",
        models / "PCM_Weights",
        ["sd15/pcm_sd15_smallcfg_2step_converted.safetensors"],
    )
    hf_download(
        "stabilityai/sd-vae-ft-mse",
        models / "sd-vae-ft-mse",
        ["config.json", "diffusion_pytorch_model.safetensors"],
    )
    install_weights(Path("."), models / "propainter")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("vendor/DiffuEraser"))
    parser.add_argument("--models-root", type=Path, default=Path("data/max-models"))
    parser.add_argument("--code-only", action="store_true")
    parser.add_argument("--models-only", action="store_true")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    models = args.models_root.expanduser().resolve()
    if not args.models_only:
        install_code(root)
    if not args.code_only:
        install_models(models)
    print(f"DIFFUERASER_ROOT={root}")
    print(f"DIFFUERASER_MODELS_ROOT={models}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(1)
