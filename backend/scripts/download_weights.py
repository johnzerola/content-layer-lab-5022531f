#!/usr/bin/env python3
"""Baixa pesos oficiais dos modelos de inpainting para `backend/models/`.

Uso:
    cd backend
    python scripts/download_weights.py --all
    python scripts/download_weights.py --propainter --sttn --lama

Os repositórios oficiais não hospedam os pesos diretamente em URLs estáveis,
então este script usa os links de release mais conhecidos. Se um link falhar,
substitua o arquivo manualmente seguindo as instruções do README.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.request import urlretrieve

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"
MODELS_DIR.mkdir(exist_ok=True)

# Links conhecidos (podem mudar; verifique os releases oficiais).
URLS = {
    "propainter": (
        "https://github.com/sczhou/ProPainter/releases/download/v0.1.0/ProPainter.pth",
        MODELS_DIR / "ProPainter.pth",
    ),
    "sttn": (
        "https://github.com/researchmm/STTN/releases/download/v1.0/sttn.pth",
        MODELS_DIR / "sttn.pth",
    ),
    "lama": (
        "https://github.com/advimman/lama/releases/download/v1.0/big-lama.pt",
        MODELS_DIR / "big-lama.pt",
    ),
}


def download(name: str, url: str, dest: Path) -> bool:
    if dest.exists():
        print(f"[skip] {name}: {dest} já existe ({dest.stat().st_size // (1024 * 1024)} MB)")
        return True
    print(f"[down] {name}: {url} -> {dest}")
    try:
        urlretrieve(url, dest)
        print(f"[ok]   {name}: {dest.stat().st_size // (1024 * 1024)} MB")
        return True
    except Exception as exc:
        print(f"[err]  {name}: {exc}")
        if dest.exists():
            dest.unlink()
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Download AI Video Cleaner model weights")
    parser.add_argument("--all", action="store_true", help="Baixa todos os pesos")
    parser.add_argument("--propainter", action="store_true", help="Baixa ProPainter.pth")
    parser.add_argument("--sttn", action="store_true", help="Baixa sttn.pth")
    parser.add_argument("--lama", action="store_true", help="Baixa big-lama.pt")
    args = parser.parse_args()

    if not any([args.all, args.propainter, args.sttn, args.lama]):
        parser.print_help()
        return 1

    selected = list(URLS.keys()) if args.all else [k for k in URLS if getattr(args, k)]
    ok = 0
    for name in selected:
        url, dest = URLS[name]
        if download(name, url, dest):
            ok += 1

    print(f"\n{ok}/{len(selected)} pesos prontos em {MODELS_DIR}")
    print("Lembre-se: ProPainter e STTN também precisam do pacote 'model/' no PYTHONPATH.")
    return 0 if ok == len(selected) else 1


if __name__ == "__main__":
    sys.exit(main())
