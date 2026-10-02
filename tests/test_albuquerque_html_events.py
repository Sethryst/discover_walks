import unittest
from unittest.mock import patch

from app.pipeline.adapters.albuquerque_html_events import AlbuquerqueHtmlEventsProvider
from app.pipeline.source_config import SourceConfig


class AlbuquerqueHtmlEventsTests(unittest.TestCase):
    def test_microformat_event_card_is_normalized(self):
        payload = b'<article><h2><a class="summary url" href="https://www.cabq.gov/events/one" title="Event">Bosque Hike</a></h2><abbr class="dtstart" title="2026-10-03T08:30:00-06:00">08:30 AM</abbr><abbr class="dtend" title="2026-10-03T11:00:00-06:00">11:00 AM</abbr><span class="location">Open Space Visitor Center</span></article>'
        source = SourceConfig.from_dict({"id": "abq", "name": "Albuquerque", "provider": "albuquerque_html_events", "url": "https://www.cabq.gov/events/events?b_start%3Aint=0", "domains": ["event"], "licenseUrl": "https://www.cabq.gov/events/events?b_start%3Aint=0", "providerOptions": {"defaultCoordinates": [-106.6504, 35.0844]}})
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return payload
        with patch("app.pipeline.adapters.albuquerque_html_events.urlopen", return_value=Response()):
            features, report = AlbuquerqueHtmlEventsProvider().acquire(source, {})
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].properties["officialUrl"], "https://www.cabq.gov/events/one")
        self.assertTrue(features[0].properties["publishable"] is False)


if __name__ == "__main__":
    unittest.main()
