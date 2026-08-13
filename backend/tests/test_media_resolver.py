from __future__ import annotations

import socket
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.services.media_resolver import MediaResolveError, resolve_public_media


PUBLIC_DNS = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
PRIVATE_DNS = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]


class FakeYoutubeDL:
    last_options = None

    def __init__(self, options):
        FakeYoutubeDL.last_options = options

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, _url, download=False):
        assert download is False
        return {
            "url": "https://cdn.example.com/video.mp4",
            "title": "Public video",
            "ext": "mp4",
            "duration": 30,
            "filesize": 1024,
            "extractor": "TikTok",
            "http_headers": {
                "User-Agent": "media-agent",
                "Referer": "https://www.tiktok.com/",
                "Cookie": "must-not-leave-worker",
            },
        }


class MediaResolverTests(unittest.TestCase):
    @patch("app.services.media_resolver.socket.getaddrinfo", return_value=PUBLIC_DNS)
    def test_resolves_muxed_public_video_and_drops_sensitive_headers(self, _dns):
        module = SimpleNamespace(YoutubeDL=FakeYoutubeDL)
        with patch.dict(sys.modules, {"yt_dlp": module}):
            result = resolve_public_media("https://www.tiktok.com/@owner/video/123", 10_000, 60)
        self.assertEqual(result["url"], "https://cdn.example.com/video.mp4")
        self.assertEqual(result["headers"]["user-agent"], "media-agent")
        self.assertNotIn("cookie", result["headers"])
        self.assertIn("acodec!=none", FakeYoutubeDL.last_options["format"])

    @patch("app.services.media_resolver.socket.getaddrinfo", return_value=PRIVATE_DNS)
    def test_rejects_platform_host_resolving_to_private_network(self, _dns):
        with self.assertRaises(MediaResolveError):
            resolve_public_media("https://www.tiktok.com/@owner/video/123", 10_000, 60)

    def test_rejects_unknown_platform_before_extractor(self):
        with self.assertRaises(MediaResolveError):
            resolve_public_media("https://example.com/post", 10_000, 60)


if __name__ == "__main__":
    unittest.main()
