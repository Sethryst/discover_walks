import json
import tempfile
import unittest
from pathlib import Path

from app.scout.national_discovery_executor import (
    DiscoveryExecutor, NationalDiscoverySpider, classify_candidate, execute,
    extract_candidate_urls, score_candidate, seed_paths_for_queries, family_relevant,
)


class NationalDiscoveryExecutorTests(unittest.TestCase):
    def test_fixture_extracts_outbound_https_links_only(self):
        html = (Path(__file__).parent / "fixtures" / "national_search_results.html").read_text()
        self.assertEqual(extract_candidate_urls(html), ["https://city.example.gov/events", "https://parks.example.org/trails"])

    def test_batch_includes_dc_and_preserves_provenance(self):
        queries = [{"queryId": "q1", "marketId": "a", "market": "A", "place": "A", "expectedSourceType": "events", "query": "a"}, {"queryId": "q2", "marketId": "washington-dc", "market": "DC", "place": "DC", "expectedSourceType": "events", "query": "dc"}]
        calls = []
        result = DiscoveryExecutor(fetcher=lambda q: (calls.append(q["queryId"]) or {"status": 200, "urls": ["https://official.gov/events", "http://bad.example/x"]})).run(queries)
        self.assertEqual(calls, ["q1", "q2"])
        self.assertEqual(result[1]["query"]["queryId"], "q2")
        self.assertEqual(result[0]["candidateUrls"], ["https://official.gov/events"])

    def test_filters_search_engine_artifacts(self):
        query = {"queryId": "q1", "marketId": "a", "market": "A", "place": "A", "expectedSourceType": "events", "query": "a"}
        result = DiscoveryExecutor(fetcher=lambda q: {"status": 200, "urls": ["https://www.google.com/js/bg/", "https://official.gov/events"]}).run([query])
        self.assertEqual(result[0]["candidateUrls"], ["https://official.gov/events"])

    def test_retries_failures_and_research_only_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); queue = root / "q.json"
            queue.write_text(json.dumps({"queries": [{"queryId": "q1", "marketId": "a", "market": "A", "place": "A", "expectedSourceType": "events", "query": "a"}]}))
            attempts = []
            def fetch(q):
                attempts.append(1)
                return {"error": "timeout", "urls": [], "attempts": 3}
            import app.scout.national_discovery_executor as mod
            old = mod.DiscoveryExecutor
            mod.DiscoveryExecutor = lambda **kwargs: old(fetcher=fetch)
            try: report = execute(queue, root / "batch.json", root / "capture.json", limit=1)
            finally: mod.DiscoveryExecutor = old
            self.assertEqual(report["summary"]["failed"], 1)
            self.assertEqual(len(attempts), 1)
            self.assertEqual(json.loads((root / "batch.json").read_text())["publicationState"], "research-only")

    def test_deduplicates_urls_and_preserves_all_query_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); queue = root / "q.json"
            base = {"marketId":"a", "market":"A", "place":"A", "expectedSourceType":"events"}
            queue.write_text(json.dumps({"queries": [{**base, "queryId":"q1", "query":"one"}, {**base, "queryId":"q2", "query":"two"}]}))
            class Fake:
                def __init__(self, **kwargs): pass
                def run(self, qs): return [{"query": q, "status":"succeeded", "candidateUrls":["https://official.gov/events"], "attempts":1} for q in qs]
            import app.scout.national_discovery_executor as mod
            old = mod.DiscoveryExecutor; mod.DiscoveryExecutor = Fake
            try: execute(queue, root / "batch.json", root / "capture.json", limit=2)
            finally: mod.DiscoveryExecutor = old
            capture = json.loads((root / "capture.json").read_text())
            self.assertEqual(len(capture["candidates"]), 1)
            self.assertEqual(capture["candidates"][0]["queryId"], "q1")

    def test_classifies_machine_readable_sources(self):
        self.assertEqual(classify_candidate("https://x.gov/events.ics", "text/calendar"), "ICS/iCalendar")
        self.assertEqual(classify_candidate("https://x.gov/feed", "application/rss+xml", "<rss></rss>"), "RSS/Atom")
        self.assertEqual(classify_candidate("https://services.arcgis.com/x/FeatureServer/0", "application/json"), "ArcGIS FeatureServer/MapServer")
        self.assertEqual(classify_candidate("https://x.gov/api/events", "application/json", "[{\"id\": 1}]"), "JSON API")
        self.assertEqual(classify_candidate("https://x.gov/events", "text/html", '{"@type":"Event"}'), "JSON-LD Event")
        self.assertEqual(classify_candidate("https://x.gov/tribe_events-sitemap.xml", "application/xml", "<urlset></urlset>"), "Sitemap")

    def test_family_relevance_filters_civic_false_positives(self):
        self.assertFalse(family_relevant("https://city.gov/residents/parking/", "events"))
        self.assertFalse(family_relevant("https://city.gov/feedback", "events"))
        self.assertTrue(family_relevant("https://city.gov/calendar", "events"))
        self.assertTrue(family_relevant("https://city.gov/parks", "parks"))

    def test_scoring_is_explainable_and_bounded(self):
        scored = score_candidate("https://city.gov/events/api", "JSON API", official_link=True, body="updated license")
        self.assertGreater(scored["confidence"], 0.7)
        self.assertEqual(set(scored["scoreBreakdown"]), {
            "official_site_link", "machine_readable_format", "event_related_path", "valid_https",
            "structured_event_fields", "stable_identifier", "freshness_signals", "licensing_or_terms_evidence",
        })
        self.assertLessEqual(scored["confidence"], 1.0)

    def test_scrapy_spider_has_required_safety_settings(self):
        settings = NationalDiscoverySpider.custom_settings
        self.assertTrue(settings["ROBOTSTXT_OBEY"])
        self.assertTrue(settings["RETRY_ENABLED"])
        self.assertFalse(settings["REDIRECT_ENABLED"])
        self.assertTrue(settings["AUTOTHROTTLE_ENABLED"])
        self.assertEqual(settings["CONCURRENT_REQUESTS_PER_DOMAIN"], 2)
        self.assertEqual(settings["DOWNLOAD_MAXSIZE"], 1_000_000)

    def test_realistic_source_fixtures_and_false_positive_filters(self):
        fixture = Path(__file__).parent / "fixtures" / "national_discovery_sources"
        self.assertEqual(classify_candidate("https://city.gov/events/feed.xml", "application/rss+xml", (fixture / "rss.xml").read_text()), "RSS/Atom")
        self.assertEqual(classify_candidate("https://city.gov/calendar.ics", "text/calendar", (fixture / "calendar.ics").read_text()), "ICS/iCalendar")
        self.assertEqual(classify_candidate("https://city.gov/events", "text/html", (fixture / "event.jsonld.html").read_text()), "JSON-LD Event")
        self.assertEqual(classify_candidate("https://services.arcgis.com/example/FeatureServer/0", "application/json", (fixture / "arcgis.json").read_text()), "ArcGIS FeatureServer/MapServer")
        self.assertEqual(classify_candidate("https://data.city.gov/resource/abcd-1234.json", "application/json", (fixture / "socrata.json").read_text()), "JSON API")
        self.assertEqual(classify_candidate("https://city.gov/calendar.ics", "text/html", "<html>fallback</html>"), "HTML calendar")
        links = extract_candidate_urls((fixture / "municipal_homepage.html").read_text())
        self.assertEqual(links, ["https://city.gov/calendar.ics", "https://city.gov/events", "https://city.gov/events/feed.xml"])

    def test_sitemap_fixture_contains_only_https_locs(self):
        sitemap = (Path(__file__).parent / "fixtures" / "national_discovery_sources" / "sitemap_index.xml").read_text()
        self.assertIn("https://city.gov/sitemap-events.xml", sitemap)
        self.assertNotIn("http://", sitemap)

    def test_query_family_seed_plan_is_deterministic_and_independent(self):
        paths = seed_paths_for_queries([{"queryFamily": "events"}, {"queryFamily": "open_data"}])
        self.assertEqual(paths[:4], ["/", "/robots.txt", "/sitemap.xml", "/sitemap_index.xml"])
        self.assertIn("/events", paths)
        self.assertIn("/open-data", paths)
        # An unsupported family does not erase or alter seeds for supported ones.
        self.assertIn("/events", seed_paths_for_queries([{"queryFamily": "events"}, {"queryFamily": "unknown"}]))


if __name__ == "__main__": unittest.main()
