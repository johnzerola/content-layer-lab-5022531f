from __future__ import annotations

from pathlib import Path
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.services.download_agent import PublicMediaDownloadAgent
from app.services.media_resolver import MediaResolveError


PUBLIC_DNS = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
PRIVATE_DNS = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]


class FakeDownloader:
    last_options = None

    def __init__(self, options):
        FakeDownloader.last_options = options

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, _url, download=False):
        info = {
            "title": "Owned video",
            "duration": 12,
            "ext": "mp4",
            "extractor": "TikTok",
            "has_drm": False,
        }
        if download:
            outtmpl = str(FakeDownloader.last_options["outtmpl"])
            Path(outtmpl.replace("%(ext)s", "mp4")).write_bytes(b"video")
        return info


class DownloadAgentTests(unittest.TestCase):
    @patch("app.services.media_resolver.socket.getaddrinfo", return_value=PUBLIC_DNS)
    def test_downloads_supported_public_media(self, _dns):
        module = SimpleNamespace(YoutubeDL=FakeDownloader)
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {"yt_dlp": module}):
            agent = PublicMediaDownloadAgent(Path(tmp), max_bytes=10_000, max_duration=60)
            result = agent.download("https://www.tiktok.com/@owner/video/123")

        self.assertEqual(result.title, "Owned video")
        self.assertEqual(result.ext, "mp4")
        self.assertEqual(result.size, 5)
        self.assertIn("best[ext=mp4]", FakeDownloader.last_options["format"])
        self.assertTrue(FakeDownloader.last_options["noplaylist"])

    @patch("app.services.media_resolver.socket.getaddrinfo", return_value=PRIVATE_DNS)
    def test_rejects_private_network_destination(self, _dns):
        with tempfile.TemporaryDirectory() as tmp:
            agent = PublicMediaDownloadAgent(Path(tmp), max_bytes=10_000, max_duration=60)
            with self.assertRaises(MediaResolveError):
                agent.download("https://www.tiktok.com/@owner/video/123")


if __name__ == "__main__":
    unittest.main()
