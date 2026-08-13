from __future__ import annotations

import unittest

import numpy as np

from app.services.mask import build_masks_window


class MaskWindowTests(unittest.TestCase):
    def test_time_ranges_and_protection_use_absolute_frames(self):
        regions = [
            {
                "id": "remove",
                "kind": "rect",
                "role": "remove",
                "x": 0.0,
                "y": 0.0,
                "w": 1.0,
                "h": 1.0,
                "from": 1.0,
                "to": 2.0,
            },
            {
                "id": "protect",
                "kind": "rect",
                "role": "protect",
                "x": 0.0,
                "y": 0.0,
                "w": 0.5,
                "h": 1.0,
                "from": 1.5,
                "to": 2.0,
            },
        ]
        removes, protects = build_masks_window(
            regions, width=20, height=10, start_frame=10, frame_count=15, fps=10.0
        )
        self.assertTrue(np.all(removes[:10] > 0))
        self.assertFalse(np.any(removes[10:] > 0))
        self.assertFalse(np.any(protects[:5] > 0))
        self.assertTrue(np.any(protects[5:10] > 0))

    def test_disabled_region_is_ignored(self):
        removes, _ = build_masks_window(
            [{
                "id": "off",
                "kind": "rect",
                "role": "remove",
                "x": 0,
                "y": 0,
                "w": 1,
                "h": 1,
                "enabled": False,
            }],
            width=8,
            height=8,
            start_frame=0,
            frame_count=2,
            fps=30.0,
        )
        self.assertFalse(np.any(removes))


if __name__ == "__main__":
    unittest.main()
