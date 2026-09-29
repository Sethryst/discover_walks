import json
import importlib.util
import tempfile
import unittest
from pathlib import Path

from app.scout.backlog import _deduplicate, build_backlog

_adapter_script = Path(__file__).parents[1] / "scripts" / "build-static-source-adapters.py"
_adapter_spec = importlib.util.spec_from_file_location("static_source_adapters", _adapter_script)
_adapter_module = importlib.util.module_from_spec(_adapter_spec)
assert _adapter_spec.loader is not None
_adapter_spec.loader.exec_module(_adapter_module)
build_static_adapters = _adapter_module.build

_diagnostic_script = Path(__file__).parents[1] / "scripts" / "diagnose_source_backlog.py"
_diagnostic_spec = importlib.util.spec_from_file_location("source_diagnostics", _diagnostic_script)
_diagnostic_module = importlib.util.module_from_spec(_diagnostic_spec)
assert _diagnostic_spec.loader is not None
_diagnostic_spec.loader.exec_module(_diagnostic_module)


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
        self.assertEqual(result["summary"]["regionCount"], 34)
        fairfax = next(region for region in result["regions"] if region["id"] == "fairfax-county-va")
        self.assertGreaterEqual(len(fairfax["queue"]), 2)
        self.assertTrue(any(item["classification"] == "INVESTIGATE" for item in fairfax["queue"]))
        self.assertNotIn("wolf-trap-va", {region["id"] for region in result["regions"]})
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

    def test_static_adapter_catalogue_covers_every_backlog_record(self) -> None:
        root = Path(__file__).parents[1]
        catalogue = build_static_adapters(root)
        self.assertEqual(catalogue["kind"], "walking-static-source-adapters")
        self.assertEqual(catalogue["summary"]["recordCount"], 102)
        self.assertEqual(len(catalogue["records"]), 102)
        self.assertEqual(len({record["id"] for record in catalogue["records"]}), 102)
        self.assertTrue(all(record["url"].startswith("https://") for record in catalogue["records"]))
        self.assertTrue(all(record["adapter"] for record in catalogue["records"]))

    def test_unresolved_diagnostics_cover_only_unintegrated_sources(self) -> None:
        root = Path(__file__).parents[1]
        report = _diagnostic_module.build(root, "2026-09-29T00:00:00Z")
        self.assertEqual(report["summary"]["resolvedCount"], 9)
        self.assertEqual(report["summary"]["unresolvedCount"], 93)
        self.assertEqual(len(report["sources"]), 93)
        self.assertTrue(all(row["blocker"] and row["nextAcquisitionPath"] for row in report["sources"]))
        self.assertTrue(all(row["publicationDecision"].startswith("NOT_PUBLISHED") for row in report["sources"]))


if __name__ == "__main__":
    unittest.main()
