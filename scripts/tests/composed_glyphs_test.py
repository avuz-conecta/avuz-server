"""Run: python3 -I scripts/tests/composed_glyphs_test.py (offline)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from composed_glyphs import COMPOSITIONS, DRAWN_GLYPHS, Composition, absolute_subpaths, avuz_glyph_path, is_avuz_glyph  # noqa: E402

FRAME = "M0-100h100v100H0Zm10-10h80v-80H10Z"
CHECK = "m20-50 20 20 40-40-5-5-35 35-15-15Z"


def fake_glyph_path(name: str) -> str:
    return {"frame": FRAME, "check": CHECK}[name]


class AbsoluteSubpaths(unittest.TestCase):
    def test_splits_subpaths_and_resolves_relative_moves(self):
        subpaths = absolute_subpaths(FRAME)

        self.assertEqual(subpaths, [
            [("M", [0, -100]), ("H", [100]), ("V", [0]), ("H", [0]), ("Z", [])],
            [("M", [10, -110]), ("H", [90]), ("V", [-190]), ("H", [10]), ("Z", [])],
        ])

    def test_reads_numbers_packed_without_separators(self):
        subpaths = absolute_subpaths("M1.5.5q-.75-1 2-3T10 10Z")

        self.assertEqual(subpaths, [[("M", [1.5, 0.5]), ("Q", [0.75, -0.5, 3.5, -2.5]), ("T", [10, 10]), ("Z", [])]])

    def test_rejects_arcs(self):
        with self.assertRaises(ValueError):
            absolute_subpaths("M0 0a5 5 0 0 1 10 0Z")


class Compose(unittest.TestCase):
    def setUp(self):
        COMPOSITIONS["test_framed_check"] = Composition("frame", slice(0, 1), "check", slice(None), 0.5, (10, -20))

    def tearDown(self):
        del COMPOSITIONS["test_framed_check"]

    def test_keeps_the_chosen_frame_subpaths_and_places_the_inner_glyph(self):
        path = avuz_glyph_path("test_framed_check", fake_glyph_path)

        self.assertEqual(path, "M0-100H100V0H0ZM20-45L30-35L50-55L47.5-57.5L30-40L22.5-47.5Z")

    def test_draws_the_filled_variant_as_the_regular_shape(self):
        self.assertTrue(is_avuz_glyph("test_framed_check-fill"))
        self.assertEqual(avuz_glyph_path("test_framed_check-fill", fake_glyph_path), avuz_glyph_path("test_framed_check", fake_glyph_path))

    def test_returns_a_drawn_glyph_as_stored_for_both_variants(self):
        self.assertEqual(avuz_glyph_path("avuz_mountains", fake_glyph_path), DRAWN_GLYPHS["avuz_mountains"])
        self.assertEqual(avuz_glyph_path("avuz_mountains-fill", fake_glyph_path), DRAWN_GLYPHS["avuz_mountains"])

    def test_leaves_plain_material_names_to_the_package(self):
        self.assertFalse(is_avuz_glyph("desktop_cloud"))


if __name__ == "__main__":
    unittest.main()
