import unittest
from unittest.mock import patch
from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.source_config import SourceConfig

class _Response:
    def __enter__(self): return self
    def __exit__(self, *args): return None
    def read(self): return b'<script type="application/ld+json">{"@type":"Event","name":"Trail day","startDate":"2026-08-08T12:00:00Z","location":{"geo":{"latitude":38.9,"longitude":-77.1}}}</script>'

class JsonLdEventsTests(unittest.TestCase):
    @patch("app.pipeline.adapters.jsonld_events.urlopen")
    def test_extracts_schema_event(self, open_url):
        open_url.return_value = _Response()
        source = SourceConfig.from_dict({"id":"jsonld","name":"JSON-LD","provider":"jsonld_events","url":"https://example.test/events","domains":["event"],"licenseUrl":"https://example.test/license"})
        features, report = JsonLdEventsProvider().acquire(source, {})
        self.assertEqual(len(features), 1)
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].geometry["coordinates"], [-77.1, 38.9])
