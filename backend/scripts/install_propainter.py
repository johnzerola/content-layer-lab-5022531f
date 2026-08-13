#!/usr/bin/env python3
"""Install the pinned official ProPainter code and its three runtime weights."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
from urllib.request import urlopen


REPOSITORY = "https://github.com/sczhou/ProPainter.git"
PINNED_COMMIT = "e870e79321c31b733e2031af5aa2fb1fe3ac7eec"
RELEASE = "https://github.com/sczhou/ProPainter/releases/download/v0.1.0"
WEIGHTS = {
    "ProPainter.pth": "12c070c4b48f374c91d8a2a17851140b85c159621080989f9e191bbc18bd6591",
    "recurrent_flow_completion.pth": "22939a1a7900da878dbe1ccd011d646b1bfb30b8290039d8ff0e0c2fefbfd283",
    "raft-things.pth": "fcfa4125d6418f4de95d84aec20a3c5f4e205101715a79f193243c186ac9a7e1",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def install_code(root: Path) -> None:
    if (root / "inference_propainter.py").is_file():
        print(f"[ok] official code already present: {root}")
        return
    if root.exists() and any(root.iterdir()):
        raise RuntimeError(f"refusing to overwrite non-empty directory: {root}")
    root.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--no-checkout", REPOSITORY, str(root)], check=True)
    subprocess.run(["git", "checkout", PINNED_COMMIT], cwd=root, check=True)
    print(f"[ok] ProPainter code pinned at {PINNED_COMMIT}")


def download(url: str, destination: Path, expected_sha256: str) -> None:
    if destination.is_file() and sha256(destination) == expected_sha256:
        print(f"[ok] {destination.name} already present")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    print(f"[download] {destination.name}")
    try:
        with urlopen(url, timeout=60) as response, partial.open("wb") as output:
            while chunk := response.read(8 * 1024 * 1024):
                output.write(chunk)
        if partial.stat().st_size < 1024 * 1024:
            raise RuntimeError(f"download too small: {partial.stat().st_size} bytes")
        actual_sha256 = sha256(partial)
        if actual_sha256 != expected_sha256:
            raise RuntimeError(
                f"checksum mismatch for {destination.name}: {actual_sha256}"
            )
        partial.replace(destination)
    finally:
        if partial.exists():
            partial.unlink()


def install_weights(root: Path, weights_dir: Path) -> None:
    for name, expected_sha256 in WEIGHTS.items():
        download(f"{RELEASE}/{name}", weights_dir / name, expected_sha256)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("vendor/ProPainter"))
    parser.add_argument("--weights-dir", type=Path)
    parser.add_argument("--code-only", action="store_true")
    parser.add_argument("--weights-only", action="store_true")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    weights_dir = (args.weights_dir or root / "weights").expanduser().resolve()
    if not args.weights_only:
        install_code(root)
    if not args.code_only:
        install_weights(root, weights_dir)
    print(f"PROPAINTER_ROOT={root}")
    print(f"PROPAINTER_WEIGHTS_DIR={weights_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(1)
