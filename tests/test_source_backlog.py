import json
import tempfile
import unittest
from pathlib import Path

from app.scout.backlog import _deduplicate, build_backlog


class SourceBacklogTests(unittest.TestCase):
    def test_duplicate_category_and_url_collapses_to_best_evidence(self) -> None:
        weak = {"category": "events", "url": "https://city.gov/calendar/", "structureClarity": "unknown", "discovery": {"confidence": 0.6}}
        strong = {"category": "events", "url": "https://city.gov/calendar", "structureClarity": "clear", "discovery": {"confidence": 0.9}}
        self.assertEqual(_deduplicate([weak, strong]), [strong])

    def test_real_workspace_backlog_is_governed_and_covers_every_region(self) -> None:
        root = Path(__file__).parents[1]
        runtime_path = root / "motherbird" / "data" / "favorites_tree.v1.json"
        before = runtime_path.read_bytes()
        result = build_backlog(root, "2026-08-20T12:00:00Z")
        self.assertEqual(result["summary"]["regionCount"], 35)
        wolf_trap = next(region for region in result["regions"] if region["id"] == "wolf-trap-va")
        self.assertGreaterEqual(len(wolf_trap["queue"]), 3)
        self.assertTrue(any(item["classification"] == "INVESTIGATE" for item in wolf_trap["queue"]))
        self.assertTrue(any(item["likelyDataType"] == "JSON API" and item["classification"] == "READY" for item in wolf_trap["queue"]))
        self.assertEqual(runtime_path.read_bytes(), before, "Backlog generation must never mutate app data")
        loudoun = next(region for region in result["regions"] if region["id"] == "loudoun-county-va")
        self.assertTrue(any(item["category"] == "volunteer" for item in loudoun["queue"]))

    def test_cli_output_can_be_written_outside_runtime(self) -> None:
        root = Path(__file__).parents[1]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "backlog.json"
            path.write_text(json.dumps(build_backlog(root, "2026-08-20T12:00:00Z")), encoding="utf-8")
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertTrue(payload["readOnly"])
            self.assertIn("review", payload["kind"])


if __name__ == "__main__":
    unittest.main()
