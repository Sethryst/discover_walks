import json
import unittest
from pathlib import Path
from xml.etree import ElementTree

from app.pipeline.adapters.rss_ics_events import _parse_xml


class PublicApiFixtureTests(unittest.TestCase):
    def test_nyc_fixture_has_event_fields_but_no_explicit_stable_id(self):
        rows = json.loads((Path(__file__).parent / "fixtures/nyc_parks_special_events_sample.json").read_text())
        self.assertEqual(rows[0]["event_name"], "PEP Family and Friends")
        self.assertIn("date_and_time", rows[0])
        self.assertNotIn("id", rows[0])

    def test_dc_fixture_parser_extracts_timestamp_and_url(self):
        payload = (Path(__file__).parent / "fixtures/dc_citywide_events_sample.xml").read_bytes()
        rows = _parse_xml(payload)
        self.assertEqual(rows[0]["name"], "Reclaiming the Edge: Urban Waterways and Civic Engagement")
        self.assertEqual(rows[0]["officialUrl"], "https://calendar.dc.gov/event/reclaiming-edge-urban-waterways-and-civic-engagement")
        self.assertEqual(rows[0]["startsAt"], "2013-04-17T16:13:50Z")
        self.assertTrue(rows[0]["timeOffsetExplicit"])


if __name__ == "__main__": unittest.main()
