import json
import tempfile
import unittest
from pathlib import Path

from app.pipeline.civic_health_cli import coverage_report


class CivicHealthTests(unittest.TestCase):
    def test_zero_event_region_becomes_an_explicit_onboarding_gap(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            civic = root / "regions" / "civic"; civic.mkdir(parents=True)
            (civic / "chicago.json").write_text(json.dumps({"regionId": "chicago", "vote": []}), encoding="utf-8")
            providers = root / "providers.json"; providers.write_text('{"providers": {}}', encoding="utf-8")
            report = coverage_report(root / "regions", root / "releases", providers)
            item = report["regions"]["chicago"]
            self.assertEqual(item["status"], "needs_source_adapter")
            self.assertIn("official calendar URL", item["onboarding"]["required"])
