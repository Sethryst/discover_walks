import json
import tempfile
import unittest
from pathlib import Path

from app.scout.engine import ScoutEngine


class CivicScoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "app/regions/profiles").mkdir(parents=True)
        (self.root / "app/regions/civic").mkdir(parents=True)
        (self.root / "releases/sample-city/civic").mkdir(parents=True)
        (self.root / "app/regions/sample-city.json").write_text(json.dumps({"id": "sample-city", "name": "Sample City", "sources": []}), encoding="utf-8")
        (self.root / "app/regions/civic-providers.json").write_text('{"providers": {}}', encoding="utf-8")
        self.discovery = json.loads((Path(__file__).parent / "fixtures/scout_discovery_sample.json").read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_classifies_ready_investigate_and_reject_with_reasoning(self) -> None:
        result = ScoutEngine(self.root).run("sample-city", self.discovery, "2026-08-07T00:00:00Z")
        by_id = {item["id"]: item for item in result["queue"]}
        self.assertEqual(by_id["official-api"]["classification"], "READY")
        self.assertEqual(by_id["uncertain-calendar"]["classification"], "INVESTIGATE")
        self.assertEqual(by_id["duplicate-pdf"]["classification"], "REJECT")
        self.assertTrue(all(item["evaluationReasoning"] for item in result["queue"]))

    def test_separates_automated_discovery_from_human_leads(self) -> None:
        result = ScoutEngine(self.root).run("sample-city", self.discovery)
        self.assertEqual(result["discoverySummary"]["automatedDiscoveryCount"], 2)
        self.assertEqual(result["discoverySummary"]["humanProvidedLeadCount"], 1)
        self.assertTrue(result["captainDecision"]["required"])

    def test_missing_information_is_rejected_before_scoring(self) -> None:
        broken = {"regionId": "sample-city", "candidates": [{"id": "missing-fields"}]}
        with self.assertRaisesRegex(ValueError, "Candidate source missing"):
            ScoutEngine(self.root).run("sample-city", broken)

    def test_uncertain_source_is_not_silently_approved(self) -> None:
        uncertain = self.discovery["candidates"][1]
        result = ScoutEngine(self.root).run("sample-city", {"regionId": "sample-city", "candidates": [uncertain]})
        self.assertEqual(result["queue"][0]["classification"], "INVESTIGATE")

    def test_mismatched_region_and_non_https_are_edge_case_failures(self) -> None:
        with self.assertRaisesRegex(ValueError, "does not match"):
            ScoutEngine(self.root).run("sample-city", {"regionId": "elsewhere", "candidates": []})
        bad = dict(self.discovery["candidates"][0], url="http://city.example.gov/api")
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            ScoutEngine(self.root).run("sample-city", {"regionId": "sample-city", "candidates": [bad]})


class DenverScoutIntegrationTests(unittest.TestCase):
    def test_denver_has_meaningful_ranked_candidate_pool(self) -> None:
        root = Path(__file__).parents[1]
        discovery = json.loads((root / "app/scout/leads/denver.json").read_text(encoding="utf-8"))
        result = ScoutEngine(root).run("denver", discovery, "2026-08-07T00:00:00Z")
        self.assertGreaterEqual(len(result["queue"]), 10)
        self.assertEqual([item["rank"] for item in result["queue"]], list(range(1, len(result["queue"]) + 1)))
        self.assertIn("events", result["region"]["missingCategories"])
        self.assertEqual(result["region"]["providerCount"]["automatedCivicProviders"], 0)


if __name__ == "__main__":
    unittest.main()
