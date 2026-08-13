"""Resolve public, authorized post URLs to a directly downloadable media stream."""
from __future__ import annotations

import ipaddress
import os
import socket
from typing import Dict
from urllib.parse import urlsplit


ALLOWED_HOST_PARTS = (
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "tiktok.com",
    "facebook.com",
    "fb.watch",
    "x.com",
    "twitter.com",
    "reddit.com",
    "redd.it",
    "vimeo.com",
    "streamable.com",
    "twitch.tv",
    "pinterest.com",
    "pin.it",
    "kwai.com",
    "dailymotion.com",
    "dai.ly",
)
SAFE_FORWARD_HEADERS = frozenset({"user-agent", "referer", "origin"})


class MediaResolveError(ValueError):
    pass


def _is_allowed_platform(hostname: str) -> bool:
    host = hostname.lower().rstrip(".")
    return any(host == part or host.endswith(f".{part}") for part in ALLOWED_HOST_PARTS)


def _validate_public_url(raw: str, *, platform_only: bool = False) -> str:
    parsed = urlsplit(raw)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise MediaResolveError("URL publica invalida")
    if platform_only and not _is_allowed_platform(parsed.hostname):
        raise MediaResolveError("plataforma nao suportada pelo resolvedor")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise MediaResolveError("nao foi possivel resolver o host") from exc
    if not addresses:
        raise MediaResolveError("host sem endereco publico")
    for result in addresses:
        if not ipaddress.ip_address(result[4][0]).is_global:
            raise MediaResolveError("destino privado nao permitido")
    return raw


def resolve_public_media(raw_url: str, max_bytes: int, max_duration: float) -> Dict[str, object]:
    url = _validate_public_url(raw_url, platform_only=True)
    try:
        import yt_dlp  # type: ignore
    except ImportError as exc:
        raise MediaResolveError("resolvedor de links nao instalado") from exc

    options: Dict[str, object] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "playlist_items": "1",
        "skip_download": True,
        "cachedir": False,
        "socket_timeout": 20,
        "retries": 2,
        "extractor_retries": 2,
        "format": (
            "best[ext=mp4][vcodec!=none][acodec!=none]/"
            "best[vcodec!=none][acodec!=none]/bestvideo[ext=mp4]/bestvideo"
        ),
    }
    cookies_file = os.getenv("CLEANER_YTDLP_COOKIES_FILE")
    if cookies_file:
        options["cookiefile"] = cookies_file

    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
    except Exception as exc:
        raise MediaResolveError("a plataforma recusou ou nao disponibilizou o video") from exc
    if not isinstance(info, dict) or info.get("_type") in {"playlist", "multi_video"}:
        raise MediaResolveError("playlists nao sao aceitas")
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise MediaResolveError("lives nao sao aceitas neste importador")
    if info.get("has_drm"):
        raise MediaResolveError("conteudo protegido por DRM nao e aceito")

    media_url = info.get("url")
    if not isinstance(media_url, str):
        raise MediaResolveError("nenhum arquivo de video publico foi encontrado")
    _validate_public_url(media_url)
    duration = float(info.get("duration") or 0)
    if duration and duration > max_duration:
        raise MediaResolveError("video excede a duracao maxima")
    size = int(info.get("filesize") or info.get("filesize_approx") or 0)
    if size and size > max_bytes:
        raise MediaResolveError("video excede o limite de tamanho")
    headers = {
        str(key).lower(): str(value)
        for key, value in (info.get("http_headers") or {}).items()
        if str(key).lower() in SAFE_FORWARD_HEADERS and isinstance(value, str)
    }
    return {
        "url": media_url,
        "headers": headers,
        "title": str(info.get("title") or "video")[:160],
        "thumbnail": str(info.get("thumbnail") or "")[:1000] or None,
        "source": str(info.get("extractor_key") or info.get("extractor") or "link").lower(),
        "ext": str(info.get("ext") or "mp4").lower(),
        "duration": duration,
        "size": size,
    }
