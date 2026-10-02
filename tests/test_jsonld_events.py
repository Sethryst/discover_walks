import unittest
from pathlib import Path
from unittest.mock import patch
from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.source_config import SourceConfig

class _Response:
    def __enter__(self): return self
    def __exit__(self, *args): return None
    def read(self): return b'<script type="application/ld+json">{"@type":"Event","name":"Trail day","startDate":"2026-08-08T12:00:00Z","location":{"geo":{"latitude":38.9,"longitude":-77.1},"address":"1 Trail Road"}}</script>'

class JsonLdEventsTests(unittest.TestCase):
    @patch("app.pipeline.adapters.jsonld_events.urlopen")
    def test_extracts_schema_event(self, open_url):
        open_url.return_value = _Response()
        source = SourceConfig.from_dict({"id":"jsonld","name":"JSON-LD","provider":"jsonld_events","url":"https://example.test/events","domains":["event"],"licenseUrl":"https://example.test/license"})
        features, report = JsonLdEventsProvider().acquire(source, {})
        self.assertEqual(len(features), 1)
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].geometry["coordinates"], [-77.1, 38.9])

    @patch("app.pipeline.adapters.jsonld_events.urlopen")
    def test_rejects_date_only_event_without_explicit_time(self, open_url):
        open_url.return_value = type("R", (), {"__enter__": lambda s: s, "__exit__": lambda *a: None, "read": lambda s: b'<script type="application/ld+json">{"@type":"Event","name":"Recurring tour","startDate":"2026-10-02","location":{"address":{"streetAddress":"1 Main St","addressLocality":"Richmond","addressRegion":"VA"}}}</script>'})()
        source = SourceConfig.from_dict({"id":"date-only","name":"JSON-LD","provider":"jsonld_events","url":"https://example.test/events","domains":["event"],"licenseUrl":"https://example.test/license"})
        features, report = JsonLdEventsProvider().acquire(source, {})
        self.assertEqual(features, [])
        self.assertEqual(report["acceptedCount"], 0)

    @patch("app.pipeline.adapters.jsonld_events.urlopen")
    def test_madison_graph_fixture_preserves_official_event_fields(self, open_url):
        payload = (Path("tests/fixtures/madison_jsonld_event.html").read_text(encoding="utf-8")).encode()
        open_url.return_value = type("R", (), {"__enter__": lambda s: s, "__exit__": lambda *a: None, "read": lambda s: payload})()
        source = SourceConfig.from_dict({"id":"madison-parks", "name":"Madison Parks Events", "provider":"jsonld_events", "url":"https://www.cityofmadison.com/parks/events/2026-10-03/bird-nature-adventures-tenney-park", "domains":["cityofmadison.com"], "licenseUrl":"https://www.cityofmadison.com/", "confidence":0.8, "providerOptions":{"defaultCoordinates":[-89.35,43.08]}})
        features, report = JsonLdEventsProvider().acquire(source, {})
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].properties["officialUrl"], source.url)
        self.assertIn("1330 Sherman Ave.", features[0].properties["venueAddress"])
        self.assertEqual(features[0].properties["startsAt"], "2026-10-03T13:30:00-05:00")
