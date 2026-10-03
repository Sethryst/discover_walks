import unittest
from pathlib import Path
from unittest.mock import patch

from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig


class _Response:
    def __init__(self, payload): self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): return None
    def read(self): return self.payload


class BostonRssAdapterTests(unittest.TestCase):
    @patch("app.pipeline.adapters.rss_ics_events.urlopen")
    def test_boston_fixture_parses_rss_event(self, open_url):
        payload = (Path(__file__).parent / "fixtures/boston_events_rss_sample.xml").read_bytes()
        open_url.return_value = _Response(payload)
        source = SourceConfig.from_dict({"id":"boston-events-rss","name":"City of Boston Events","provider":"rss_ics_events","url":"https://www.boston.gov/rss/events","domains":["event"],"licenseUrl":"https://www.boston.gov/government/cabinets/innovation-and-technology/terms-use-and-privacy-policy-city-boston-digital","providerOptions":{"defaultCoordinates":[-71.0589,42.3601]}})
        features, report = RssIcsEventsProvider().acquire(source, {})
        self.assertEqual(report["format"], "rss-atom")
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0].properties["startsAt"], "2026-09-15T15:45:16Z")


if __name__ == "__main__": unittest.main()
