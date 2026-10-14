import unittest

from app.scout.discovery_intelligence import (
    canonical_url, merge_observations, observation_from_candidate,
    rank_next_investigations,
)


class DiscoveryIntelligenceTests(unittest.TestCase):
    def test_observation_is_review_only_and_canonical(self):
        row = observation_from_candidate({"url": "HTTPS://City.gov/events/", "category": "events", "dataType": "JSON API", "discovery": {"origin": "automated", "method": "probe", "confidence": .9}})
        self.assertEqual(row["url"], "https://city.gov/events")
        self.assertEqual(row["publication"], {"state": "research-only", "published": False})
        self.assertTrue(row["id"].startswith("source-observation-"))

    def test_merge_keeps_latest_observation_and_counts_history(self):
        first = {"url": "https://city.gov/events/", "category": "events", "observedAt": "2026-01-01T00:00:00Z", "outcome": "discovered"}
        second = {"url": "https://city.gov/events", "category": "events", "observedAt": "2026-01-02T00:00:00Z", "outcome": "validated"}
        merged = merge_observations([first, second])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["outcome"], "validated")
        self.assertEqual(merged[0]["observationCount"], 2)

    def test_ranker_explains_score_and_prefers_missing_structured_source(self):
        candidates = [
            {"url": "https://city.gov/parks", "category": "parks", "dataType": "HTML calendar", "authority": "government", "coverageValue": "medium", "discovery": {"confidence": .8}},
            {"url": "https://city.gov/events.json", "category": "events", "dataType": "JSON API", "authority": "government", "coverageValue": "high", "discovery": {"confidence": .9}},
        ]
        ranked = rank_next_investigations(candidates, missing_categories={"events"})
        self.assertEqual(ranked[0]["category"], "events")
        self.assertEqual(ranked[0]["recommendation"]["rank"], 1)
        self.assertIn("informationGain", ranked[0]["recommendation"]["components"])
        self.assertEqual(ranked[0]["recommendation"]["publicationState"], "research-only")


if __name__ == "__main__":
    unittest.main()
