import json
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pipeline.adapters.nyc_socrata_events import NycSocrataEventsProvider
from app.pipeline.adapters.dc_rss_events import DcRssEventsProvider
from app.pipeline.contracts import validate_release
from app.pipeline.source_config import SourceConfig


class Response:
    def __init__(self, body, headers=None): self.body, self.headers = body, headers or {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self): return self.body


class BoundedReleasePathTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = Path(__file__).parent / "fixtures"
        self.nyc = SourceConfig.from_dict({"id":"nyc","name":"NYC Parks","provider":"nyc_socrata_events","url":"https://data.cityofnewyork.us/resource/6v4b-5gp4.json","domains":["event"],"licenseUrl":"https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje","providerOptions":{"defaultCoordinates":[-73.98,40.75]}})
        self.dc = SourceConfig.from_dict({"id":"dc","name":"DC Calendar","provider":"dc_rss_events","url":"https://calendar.dc.gov/node/all/events","domains":["event"],"licenseUrl":"https://oca.dc.gov/page/agency-data-terms-use"})

    def test_fixture_adapter_normalize_dedupe_release_and_restrictions(self):
        nyc_body=(self.fixtures/'nyc_parks_special_events_sample.json').read_bytes(); dc_body=(self.fixtures/'dc_citywide_events_sample.xml').read_bytes()
        with patch('app.pipeline.adapters.nyc_socrata_events.urlopen', return_value=Response(nyc_body, {'Last-Modified':'Wed, 16 Sep 2026 15:00:15 GMT'})):
            nyc_a, nyc_report=NycSocrataEventsProvider().acquire(self.nyc,{})
        with patch('app.pipeline.adapters.dc_rss_events.urlopen', return_value=Response(dc_body, {'Cache-Control':'public, max-age=1800'})):
            dc_a, dc_report=DcRssEventsProvider().acquire(self.dc,{})
        with patch('app.pipeline.adapters.nyc_socrata_events.urlopen', return_value=Response(nyc_body, {'Last-Modified':'Wed, 16 Sep 2026 15:00:15 GMT'})):
            nyc_b, _=NycSocrataEventsProvider().acquire(self.nyc,{})
        self.assertEqual([x.source_id for x in nyc_a], [x.source_id for x in nyc_b])
        self.assertEqual(nyc_a[0].properties['timeSemantics'], 'unspecified-wall-time')
        self.assertEqual(nyc_report['freshnessPolicy'], 'one-month-publication-delay')
        self.assertEqual(dc_a[0].properties['startsAt'], '2013-04-17T16:13:50Z')
        self.assertEqual(dc_report['pollMinSeconds'], 1800)
        all_features=nyc_a+dc_a+nyc_a
        unique={x.source_id:x for x in all_features}
        self.assertEqual(len(unique), 2)
        pois=[{'id':x.source_id,'name':x.properties['name'],'lat':x.geometry['coordinates'][1],'lng':x.geometry['coordinates'][0],'category':'event','timeSemantics':x.properties.get('timeSemantics')} for x in unique.values()]
        release={'schemaVersion':1,'regionId':'bounded-public-sources','generatedAt':'2026-09-30T00:00:00Z','producer':{'name':'bounded-test','version':'1'},'pois':pois}
        validate_release(release)
        self.assertEqual(nyc_a[0].metadata['sourceMetadata']['freshnessPolicy'], 'one-month-publication-delay')
        self.assertEqual(dc_a[0].metadata['sourceMetadata']['pollMinSeconds'], 1800)


if __name__ == '__main__': unittest.main()
