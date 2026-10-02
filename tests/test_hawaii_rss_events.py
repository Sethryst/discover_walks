import unittest
from unittest.mock import patch

from app.pipeline.adapters.hawaii_rss_events import HawaiiPublicMeetingsProvider
from app.pipeline.source_config import SourceConfig


class HawaiiRssEventsTests(unittest.TestCase):
    def test_description_date_and_time_become_localized_event(self):
        payload = b'''<?xml version="1.0"?><rss><channel><item><title>Board meeting</title><link>https://calendar.ehawaii.gov/calendar/meeting/1/details.html</link><description>Location: Honolulu\nDate: 2026/10/02 - 2026/10/02\nTime: 09:00 AM - 11:00 AM</description><pubDate>Thu, 24 Sep 2026 23:06:55 GMT</pubDate></item></channel></rss>'''
        source = SourceConfig.from_dict({"id": "hawaii", "name": "Hawaii", "provider": "hawaii_public_meetings", "url": "https://calendar.ehawaii.gov/calendar/upcoming-events.rss", "domains": ["event"], "licenseUrl": "https://calendar.ehawaii.gov/calendar/rss.html", "providerOptions": {"defaultCoordinates": [-157.8583, 21.3069]}})
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return payload
        with patch("app.pipeline.adapters.hawaii_rss_events.urlopen", return_value=Response()):
            features, report = HawaiiPublicMeetingsProvider().acquire(source, {})
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].properties["startsAt"], "2026-10-02T09:00:00-10:00")
        self.assertEqual(features[0].properties["officialUrl"], "https://calendar.ehawaii.gov/calendar/meeting/1/details.html")


if __name__ == "__main__":
    unittest.main()
