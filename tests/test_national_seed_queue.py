import json
import tempfile
import unittest
from pathlib import Path

from app.scout.national_seed_queue import build_queue, validate_seeds, write_artifacts


ROOT = Path(__file__).parents[1]
SEEDS = ROOT / "expansion-queues" / "national-region-seeds.csv"


class NationalSeedQueueTests(unittest.TestCase):
    def test_current_catalog_valid_and_expanded(self):
        report = validate_seeds(SEEDS)
        self.assertTrue(report["valid"], report)
        self.assertGreaterEqual(report["seedCount"], 90)
        self.assertGreaterEqual(report["marketCount"], 45)

    def test_deterministic_unique_queries_and_families(self):
        first, _, _ = build_queue(SEEDS)
        second, _, _ = build_queue(SEEDS)
        self.assertEqual(first, second)
        self.assertEqual(len(first), len({x["queryId"] for x in first}))
        self.assertEqual(len(first), len({x["query"] for x in first}))
        self.assertGreaterEqual(len({x["queryFamily"] for x in first}), 10)

    def test_artifacts_are_research_only(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "queue.json"
            payload = write_artifacts(SEEDS, out)
            self.assertEqual(payload["publicationState"], "research-only")
            self.assertTrue((Path(folder) / "national-seed-validation-report.json").exists())

    def test_quality_and_governance_increment(self):
        queue, _, _ = build_queue(SEEDS)
        self.assertTrue({item["providerStatus"] for item in queue} == {"candidate"})
        self.assertTrue(all(0 <= item["sourceConfidence"]["score"] <= 1 for item in queue))
        self.assertTrue(all("retired_url" in item["negativeDiscoveryCodes"] for item in queue))


if __name__ == "__main__":
    unittest.main()
