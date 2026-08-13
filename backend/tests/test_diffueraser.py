from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from app.engines.diffueraser_official import (
    build_diffueraser_command,
    diffueraser_status,
)


class DiffuEraserAdapterTests(unittest.TestCase):
    def test_status_is_not_ready_without_code_models_and_cuda(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"DIFFUERASER_ROOT": directory, "DIFFUERASER_MODELS_ROOT": directory},
            clear=False,
        ), patch("app.engines.diffueraser_official.cuda_available", return_value=False):
            status = diffueraser_status()
            self.assertFalse(status.ready)
            self.assertIn("cuda", status.missing)
            self.assertIn("run_diffueraser.py", status.missing)

    def test_command_uses_official_cli_and_explicit_model_paths(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "DIFFUERASER_ROOT": directory,
                "DIFFUERASER_MODELS_ROOT": directory,
                "DIFFUERASER_MAX_SIDE": "720",
            },
            clear=False,
        ):
            command = build_diffueraser_command(
                "input.mp4", "mask.mp4", "output", duration=10.2
            )
            self.assertTrue(command[1].endswith("run_diffueraser.py"))
            self.assertEqual(command[command.index("--video_length") + 1], "11")
            self.assertEqual(command[command.index("--max_img_size") + 1], "720")
            self.assertIn("--diffueraser_path", command)
            self.assertIn("--propainter_model_dir", command)


if __name__ == "__main__":
    unittest.main()
