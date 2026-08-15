#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.download_agent import PublicMediaDownloadAgent
from app.services.media_resolver import MediaResolveError


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Baixa videos publicos/autorizados por link usando yt-dlp.",
    )
    parser.add_argument("url", help="Link publico/autorizado do video")
    parser.add_argument("--out", default="downloads", help="Pasta de saida")
    parser.add_argument("--max-gb", type=float, default=2.0, help="Tamanho maximo do arquivo")
    parser.add_argument("--max-duration", type=float, default=3600, help="Duracao maxima em segundos")
    parser.add_argument("--cookies", default=None, help="Arquivo de cookies de conta propria/autorizada")
    parser.add_argument("--probe", action="store_true", help="Apenas analisa sem baixar")
    args = parser.parse_args()

    agent = PublicMediaDownloadAgent(
        Path(args.out),
        max_bytes=int(max(0.05, args.max_gb) * 1024**3),
        max_duration=max(1, args.max_duration),
        cookies_file=args.cookies,
    )

    try:
        if args.probe:
            info = agent.probe(args.url)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "title": info.get("title"),
                        "source": info.get("extractor_key") or info.get("extractor"),
                        "duration": info.get("duration"),
                        "ext": info.get("ext"),
                        "has_drm": info.get("has_drm", False),
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        result = agent.download(args.url)
        print(
            json.dumps(
                {
                    "ok": True,
                    "path": str(result.path),
                    "title": result.title,
                    "source": result.source,
                    "ext": result.ext,
                    "duration": result.duration,
                    "size": result.size,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except MediaResolveError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
