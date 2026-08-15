"""Authorized public media download agent.

The agent uses yt-dlp to fetch user-provided public URLs from supported
platforms. It prefers the original downloadable media exposed by the platform
or extractor, but it does not bypass DRM, private accounts, paywalls, or remove
watermarks that are already burned into the pixels.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Dict, Optional
import uuid

from .media_resolver import MediaResolveError, _validate_public_url


@dataclass(frozen=True)
class DownloadedMedia:
    path: Path
    title: str
    source: str
    ext: str
    duration: float
    size: int
    original_url: str


class PublicMediaDownloadAgent:
    """Downloads public or explicitly authorized videos by link.

    Use this for user-owned/licensed media only. The implementation stays inside
    yt-dlp's public extractors and optional user-provided cookies.
    """

    def __init__(
        self,
        output_dir: Path,
        *,
        max_bytes: int,
        max_duration: float,
        cookies_file: Optional[str] = None,
    ) -> None:
        self.output_dir = output_dir
        self.max_bytes = max_bytes
        self.max_duration = max_duration
        self.cookies_file = cookies_file or os.getenv("CLEANER_YTDLP_COOKIES_FILE")

    def _options(self, stem: str) -> Dict[str, object]:
        options: Dict[str, object] = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "playlist_items": "1",
            "cachedir": False,
            "socket_timeout": 25,
            "retries": 2,
            "fragment_retries": 2,
            "extractor_retries": 2,
            "continuedl": False,
            "overwrites": False,
            "restrictfilenames": True,
            "outtmpl": str(self.output_dir / f"{stem}.%(ext)s"),
            "merge_output_format": "mp4",
            "max_filesize": self.max_bytes,
            "format": (
                "best[ext=mp4][vcodec!=none][acodec!=none]/"
                "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
                "best[vcodec!=none][acodec!=none]/best"
            ),
        }
        if self.cookies_file:
            options["cookiefile"] = self.cookies_file
        return options

    def probe(self, url: str) -> Dict[str, object]:
        """Return yt-dlp metadata without downloading."""
        public_url = _validate_public_url(url, platform_only=True)
        try:
            import yt_dlp  # type: ignore
        except ImportError as exc:
            raise MediaResolveError("yt-dlp nao esta instalado") from exc

        with yt_dlp.YoutubeDL(self._options("probe")) as downloader:
            info = downloader.extract_info(public_url, download=False)
        if not isinstance(info, dict) or info.get("_type") in {"playlist", "multi_video"}:
            raise MediaResolveError("playlists nao sao aceitas")
        if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
            raise MediaResolveError("lives nao sao aceitas neste importador")
        if info.get("has_drm"):
            raise MediaResolveError("conteudo protegido por DRM nao e aceito")
        duration = float(info.get("duration") or 0)
        if duration and duration > self.max_duration:
            raise MediaResolveError("video excede a duracao maxima")
        size = int(info.get("filesize") or info.get("filesize_approx") or 0)
        if size and size > self.max_bytes:
            raise MediaResolveError("video excede o limite de tamanho")
        return info

    def download(self, url: str) -> DownloadedMedia:
        """Download the best available public media file into output_dir."""
        public_url = _validate_public_url(url, platform_only=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        stem = f"media-{uuid.uuid4().hex}"

        try:
            import yt_dlp  # type: ignore
        except ImportError as exc:
            raise MediaResolveError("yt-dlp nao esta instalado") from exc

        try:
            with yt_dlp.YoutubeDL(self._options(stem)) as downloader:
                info = downloader.extract_info(public_url, download=True)
        except Exception as exc:
            raise MediaResolveError("a plataforma recusou ou nao disponibilizou o download") from exc

        if not isinstance(info, dict):
            raise MediaResolveError("resposta invalida do resolvedor")
        if info.get("has_drm"):
            raise MediaResolveError("conteudo protegido por DRM nao e aceito")

        candidates = sorted(self.output_dir.glob(f"{stem}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            raise MediaResolveError("download nao gerou arquivo")
        path = candidates[0]
        size = path.stat().st_size
        if size <= 0:
            path.unlink(missing_ok=True)
            raise MediaResolveError("arquivo baixado vazio")
        if size > self.max_bytes:
            path.unlink(missing_ok=True)
            raise MediaResolveError("video excede o limite de tamanho")

        duration = float(info.get("duration") or 0)
        if duration and duration > self.max_duration:
            path.unlink(missing_ok=True)
            raise MediaResolveError("video excede a duracao maxima")

        return DownloadedMedia(
            path=path,
            title=str(info.get("title") or "video")[:160],
            source=str(info.get("extractor_key") or info.get("extractor") or "link").lower(),
            ext=path.suffix.lstrip(".").lower() or str(info.get("ext") or "mp4").lower(),
            duration=duration,
            size=size,
            original_url=public_url,
        )
