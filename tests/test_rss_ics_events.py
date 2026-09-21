import unittest
from unittest.mock import patch
from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig

class _Response:
    def __init__(self, payload): self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): return None
    def read(self): return self.payload

class RssIcsEventsTests(unittest.TestCase):
    def setUp(self):
        self.source = SourceConfig.from_dict({"id": "fixture-events", "name": "Fixture Events", "provider": "rss_ics_events", "url": "https://example.test/feed", "domains": ["event"], "licenseUrl": "https://example.test/license", "providerOptions": {"defaultCoordinates": [-77.1, 38.9]}})

    @patch("app.pipeline.adapters.rss_ics_events.urlopen")
    def test_rss_parses(self, open_url):
        open_url.return_value = _Response(b"<rss><channel><item><title>Walk</title><pubDate>Sat, 08 Aug 2026 12:00:00 GMT</pubDate><link>https://example.test/walk</link></item></channel></rss>")
        features, report = RssIcsEventsProvider().acquire(self.source, {})
        self.assertEqual(len(features), 1)
        self.assertEqual(report["format"], "rss-atom")

    @patch("app.pipeline.adapters.rss_ics_events.urlopen")
    def test_ics_parses_uid_and_dates(self, open_url):
        open_url.return_value = _Response(b"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Bird walk\r\nDTSTART:20260808T120000Z\r\nEND:VEVENT\r\nEND:VCALENDAR")
        features, _ = RssIcsEventsProvider().acquire(self.source, {})
        self.assertEqual(features[0].source_id, "abc")
        self.assertEqual(features[0].properties["startsAt"], "2026-08-08T12:00:00Z")
