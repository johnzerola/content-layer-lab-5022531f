#!/usr/bin/env python3
"""Backward-compatible entry point for the complete ProPainter weights."""
from __future__ import annotations

import argparse
from pathlib import Path

from install_propainter import install_weights


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download all weights required by the official ProPainter pipeline"
    )
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--propainter", action="store_true")
    parser.add_argument("--weights-dir", type=Path, default=Path("models"))
    args = parser.parse_args()
    if not args.all and not args.propainter:
        parser.print_help()
        return 1
    install_weights(Path("."), args.weights_dir.expanduser().resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
