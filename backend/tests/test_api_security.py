from __future__ import annotations

import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


TEMPORARY = tempfile.TemporaryDirectory()
os.environ["CLEANER_STORAGE"] = TEMPORARY.name
os.environ["CLEANER_WORKER_SECRET"] = "s" * 48
os.environ["CLEANER_ALLOWED_HOSTS"] = "testserver,localhost,127.0.0.1"
os.environ["CLEANER_MAX_UPLOAD_GB"] = "0.05"

from app.main import ACTIVE_JOBS, SETTINGS, app  # noqa: E402
from app.security import create_job_token, create_service_token  # noqa: E402


JOB_ID = "00000000-0000-4000-8000-000000000002"


class ApiSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        TEMPORARY.cleanup()

    def token(self, scope: str) -> str:
        return create_job_token(SETTINGS.worker_secret, JOB_ID, scope, 300)

    def service_token(self) -> str:
        return create_service_token(SETTINGS.worker_secret, "media", 300)

    @patch("app.main.resolve_public_media")
    def test_media_resolver_requires_service_token(self, resolver):
        resolver.return_value = {
            "url": "https://cdn.example.com/video.mp4",
            "headers": {},
            "title": "video",
            "source": "test",
            "ext": "mp4",
        }
        missing = self.client.post(
            "/v1/media/resolve", json={"url": "https://www.tiktok.com/@owner/video/123"}
        )
        valid = self.client.post(
            "/v1/media/resolve",
            headers={"x-service-token": self.service_token()},
            json={"url": "https://www.tiktok.com/@owner/video/123"},
        )
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(valid.status_code, 200)

    def test_upload_rejects_wrong_scope(self):
        response = self.client.post(
            f"/v1/jobs/{JOB_ID}/upload",
            headers={"x-job-token": self.token("control"), "x-file-size": "4"},
            files={"file": ("video.mp4", b"test", "video/mp4")},
        )
        self.assertEqual(response.status_code, 401)

    def test_upload_rejects_claim_above_limit_before_writing(self):
        response = self.client.post(
            f"/v1/jobs/{JOB_ID}/upload",
            headers={
                "x-job-token": self.token("upload"),
                "x-file-size": str(SETTINGS.max_upload_bytes + 1),
            },
            files={"file": ("video.mp4", b"test", "video/mp4")},
        )
        self.assertEqual(response.status_code, 413)
        self.assertFalse((Path(TEMPORARY.name) / JOB_ID / "input.mp4").exists())

    @patch("app.main.shutil.disk_usage")
    @patch("app.main._validate_video")
    def test_upload_returns_per_file_digest(self, validate_video, disk_usage):
        disk_usage.return_value = shutil._ntuple_diskusage(200 * 1024**3, 10 * 1024**3, 190 * 1024**3)
        validate_video.return_value = {
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "duration": 5,
            "frames": 150,
            "has_audio": True,
        }
        response = self.client.post(
            f"/v1/jobs/{JOB_ID}/upload",
            headers={"x-job-token": self.token("upload"), "x-file-size": "4"},
            files={"file": ("video.mp4", b"test", "video/mp4")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["file_id"]), 64)
        repeated = self.client.post(
            f"/v1/jobs/{JOB_ID}/upload",
            headers={"x-job-token": self.token("upload"), "x-file-size": "4"},
            files={"file": ("video.mp4", b"test", "video/mp4")},
        )
        self.assertEqual(repeated.status_code, 409)

    def test_result_requires_result_scope(self):
        directory = Path(TEMPORARY.name) / JOB_ID
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "output.mp4").write_bytes(b"result")
        missing = self.client.get(f"/v1/jobs/{JOB_ID}/result")
        wrong = self.client.get(
            f"/v1/jobs/{JOB_ID}/result", params={"token": self.token("control")}
        )
        valid = self.client.get(
            f"/v1/jobs/{JOB_ID}/result", params={"token": self.token("result")}
        )
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.content, b"result")

    def test_delete_removes_all_job_files_and_rejects_active_job(self):
        directory = Path(TEMPORARY.name) / JOB_ID
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "input.mp4").write_bytes(b"video")
        ACTIVE_JOBS.add(JOB_ID)
        try:
            active = self.client.delete(
                f"/v1/jobs/{JOB_ID}", headers={"x-job-token": self.token("control")}
            )
        finally:
            ACTIVE_JOBS.discard(JOB_ID)
        deleted = self.client.delete(
            f"/v1/jobs/{JOB_ID}", headers={"x-job-token": self.token("control")}
        )
        self.assertEqual(active.status_code, 409)
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(directory.exists())


if __name__ == "__main__":
    unittest.main()
