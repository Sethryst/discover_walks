import json
import unittest
from unittest.mock import patch

from app.pipeline.adapters.austin_socrata_events import AustinSocrataEventsProvider
from app.pipeline.source_config import SourceConfig


class AustinSocrataEventsTests(unittest.TestCase):
    def test_known_fields_become_research_only_features(self):
        payload = json.dumps([{"arrive_date": "2026-10-02T00:00:00", "depart_date": "2026-10-04T00:00:00", "location": "Palmer Events Center", "event_name": "Austin Event", "website": "https://example.gov/event"}]).encode()
        source = SourceConfig.from_dict({"id": "austin", "name": "Austin ACCD", "provider": "austin_socrata_events", "url": "https://data.austintexas.gov/resource/p9ma-z6y9.json?$limit=1", "domains": ["event"], "licenseUrl": "https://data.austintexas.gov/", "providerOptions": {"defaultCoordinates": [-97.7431, 30.2672]}})
        class Response:
            headers = {"Last-Modified": "Fri, 02 Oct 2026 00:00:00 GMT"}
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return payload
        with patch("app.pipeline.adapters.austin_socrata_events.urlopen", return_value=Response()):
            features, report = AustinSocrataEventsProvider().acquire(source, {})
        self.assertEqual(report["acceptedCount"], 1)
        self.assertEqual(features[0].properties["officialUrl"], "https://example.gov/event")
        self.assertFalse(features[0].properties["publishable"])


if __name__ == "__main__":
    unittest.main()
