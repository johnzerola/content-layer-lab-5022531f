from __future__ import annotations

import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from app.config import get_settings
from app.security import (
    TokenError,
    callback_signature,
    create_job_token,
    create_service_token,
    validate_callback_url,
    validate_job_token,
    validate_service_token,
)
from app.storage import cleanup_expired, read_state, write_state


JOB_ID = "00000000-0000-4000-8000-000000000001"
SECRET = "a" * 48


class JobTokenTests(unittest.TestCase):
    def test_token_is_job_scoped_operation_scoped_and_expires(self):
        token = create_job_token(SECRET, JOB_ID, "upload", 60, now=1000)
        self.assertEqual(validate_job_token(SECRET, JOB_ID, token, ["upload"], now=1059), "upload")
        with self.assertRaises(TokenError):
            validate_job_token(SECRET, JOB_ID, token, ["control"], now=1059)
        with self.assertRaises(TokenError):
            validate_job_token(SECRET, JOB_ID, token, ["upload"], now=1061)
        with self.assertRaises(TokenError):
            validate_job_token("b" * 48, JOB_ID, token, ["upload"], now=1059)

    def test_callback_signature_binds_timestamp_and_body(self):
        signature = callback_signature(SECRET, "1000", '{"ok":true}')
        self.assertNotEqual(signature, callback_signature(SECRET, "1001", '{"ok":true}'))
        self.assertNotEqual(signature, callback_signature(SECRET, "1000", '{"ok":false}'))

    def test_service_token_is_scoped_signed_and_expires(self):
        token = create_service_token(SECRET, "media", 30, now=100)
        self.assertEqual(validate_service_token(SECRET, token, {"media"}, now=120), "media")
        with self.assertRaises(TokenError):
            validate_service_token(SECRET, token, {"media"}, now=131)
        with self.assertRaises(TokenError):
            validate_service_token("x" * 48, token, {"media"}, now=120)


class CallbackUrlTests(unittest.TestCase):
    @patch("app.security.socket.getaddrinfo")
    def test_callback_requires_allowlisted_public_https_origin(self, getaddrinfo):
        getaddrinfo.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]
        url = "https://app.example.com/api/public/cleaner-callback"
        self.assertEqual(validate_callback_url(url, ["https://app.example.com"]), url)
        with self.assertRaises(ValueError):
            validate_callback_url("http://app.example.com/callback", ["https://app.example.com"])
        with self.assertRaises(ValueError):
            validate_callback_url("https://other.example.com/callback", ["https://app.example.com"])

    @patch("app.security.socket.getaddrinfo")
    def test_callback_rejects_private_dns(self, getaddrinfo):
        getaddrinfo.return_value = [(2, 1, 6, "", ("127.0.0.1", 443))]
        with self.assertRaises(ValueError):
            validate_callback_url("https://app.example.com/callback", ["https://app.example.com"])


class ConfigurationAndStorageTests(unittest.TestCase):
    def test_production_rejects_weak_secret(self):
        with patch.dict(
            os.environ,
            {
                "CLEANER_ENV": "production",
                "CLEANER_WORKER_SECRET": "short",
                "CORS_ORIGINS": "https://app.example.com",
                "CLEANER_CALLBACK_ORIGINS": "https://app.example.com",
            },
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                get_settings()

    def test_cleanup_keeps_active_jobs_and_removes_expired_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = root / "old"
            active = root / "active"
            write_state(old, {"status": "completed"})
            write_state(active, {"status": "processing"})
            stale = int(time.time()) - 10_000
            for directory in (old, active):
                state = read_state(directory)
                state["updated_at"] = stale
                (directory / "state.json").write_text(str(state).replace("'", '"'), encoding="utf-8")
            self.assertEqual(cleanup_expired(root, 100), 1)
            self.assertFalse(old.exists())
            self.assertTrue(active.exists())


if __name__ == "__main__":
    unittest.main()
