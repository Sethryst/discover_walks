import json
import unittest
from unittest.mock import patch

from app.pipeline.adapters.cleveland_fullcalendar_events import ClevelandFullCalendarProvider
from app.pipeline.source_config import SourceConfig


class ClevelandFullCalendarTests(unittest.TestCase):
    def test_embedded_calendar_events_are_normalized(self):
        options = json.dumps({"timeZone": "America/New_York", "events": [{"eid": "42", "title": "Civic meeting", "start": "2026-10-02T10:00:00", "url": "/events/civic-meeting"}]}).replace('"', '\\u0022').replace('/', '\\\/')
        payload = f'<script>"calendar_options":"{options}","dialog_options":"{{}}"</script>'.encode()
        source = SourceConfig.from_dict({"id": "cleveland", "name": "Cleveland", "provider": "cleveland_fullcalendar_events", "url": "https://www.clevelandohio.gov/events", "domains": ["event"], "licenseUrl": "https://www.clevelandohio.gov/events", "providerOptions": {"defaultCoordinates": [-81.6944, 41.4993]}})
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return payload
        with patch("app.pipeline.adapters.cleveland_fullcalendar_events.urlopen", return_value=Response()):
            features, report = ClevelandFullCalendarProvider().acquire(source, {})
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].properties["officialUrl"], "https://www.clevelandohio.gov/events/civic-meeting")
        self.assertFalse(features[0].properties["publishable"])


if __name__ == "__main__":
    unittest.main()
