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

    @patch("app.pipeline.adapters.rss_ics_events.urlopen")
    def test_civicplus_ics_preserves_timezone_and_official_url(self, open_url):
        payload = open("tests/fixtures/charleston_civicplus_event.ics", encoding="utf-8").read().encode()
        open_url.return_value = _Response(payload)
        source = SourceConfig.from_dict({"id": "charleston-civicplus", "name": "Charleston Events", "provider": "rss_ics_events", "url": "https://www.charleston-sc.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&eventID=10637", "domains": ["charleston-sc.gov"], "licenseUrl": "https://www.charleston-sc.gov/", "providerOptions": {"defaultCoordinates": [-79.93, 32.78]}})
        features, report = RssIcsEventsProvider().acquire(source, {})
        self.assertEqual(report["format"], "ics")
        self.assertEqual(features[0].source_id, "10637")
        self.assertEqual(features[0].properties["startsAt"], "2026-10-29T19:00:00Z")
        self.assertEqual(features[0].properties["endsAt"], "2026-10-29T22:00:00Z")
        self.assertEqual(features[0].properties["officialUrl"], "https://www.charleston-sc.gov/calendar.aspx?EID=10637")

    @patch("app.pipeline.adapters.rss_ics_events.urlopen")
    def test_durham_civicengage_ics_preserves_meeting_identity(self, open_url):
        payload = open("tests/fixtures/durham_civicplus_event.ics", encoding="utf-8").read().encode()
        open_url.return_value = _Response(payload)
        source = SourceConfig.from_dict({"id": "durham-civicengage", "name": "Durham Official Calendar", "provider": "rss_ics_events", "url": "https://www.durhamnc.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&eventID=10435", "domains": ["durhamnc.gov"], "licenseUrl": "https://www.durhamnc.gov/", "providerOptions": {"defaultCoordinates": [-78.90, 36.00]}})
        features, report = RssIcsEventsProvider().acquire(source, {})
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].source_id, "10435")
        self.assertEqual(features[0].properties["startsAt"], "2026-10-05T23:00:00Z")
        self.assertEqual(features[0].properties["officialUrl"], "https://www.durhamnc.gov/calendar.aspx?EID=10435")
