import json
import unittest
from pathlib import Path
from unittest.mock import patch
from app.pipeline.adapters.nyc_socrata_events import NycSocrataEventsProvider
from app.pipeline.adapters.dc_rss_events import DcRssEventsProvider
from app.pipeline.source_config import SourceConfig

class Response:
    def __init__(self, body, headers=None): self.body=body; self.headers=headers or {}
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self): return self.body
    def getcode(self): return 200

class BoundedPublicSourceTests(unittest.TestCase):
    def test_nyc_wall_time_fallback_and_freshness(self):
        body=(Path(__file__).parent/'fixtures/nyc_parks_special_events_sample.json').read_bytes()
        source=SourceConfig.from_dict({'id':'nyc','name':'NYC Parks','provider':'nyc_socrata_events','url':'https://data.cityofnewyork.us/resource/6v4b-5gp4.json','domains':['event'],'licenseUrl':'https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje','providerOptions':{'defaultCoordinates':[-73.98,40.75]}})
        with patch('app.pipeline.adapters.nyc_socrata_events.urlopen',return_value=Response(body,{'Last-Modified':'Wed, 16 Sep 2026 15:00:15 GMT'})):
            features, report=NycSocrataEventsProvider().acquire(source,{})
        self.assertEqual(report['timeSemantics'],'unspecified-wall-time'); self.assertEqual(report['freshnessPolicy'],'one-month-publication-delay'); self.assertTrue(features[0].source_id.startswith('event-fallback-')); self.assertEqual(features[0].properties['startsAt'],'2019-10-12T11:00:00.000')
    def test_dc_offset_and_poll_interval(self):
        body=(Path(__file__).parent/'fixtures/dc_citywide_events_sample.xml').read_bytes(); source=SourceConfig.from_dict({'id':'dc','name':'DC Calendar','provider':'dc_rss_events','url':'https://calendar.dc.gov/node/all/events','domains':['event'],'licenseUrl':'https://oca.dc.gov/page/agency-data-terms-use'})
        with patch('app.pipeline.adapters.dc_rss_events.urlopen',return_value=Response(body,{'Cache-Control':'public, max-age=1800'})):
            features, report=DcRssEventsProvider().acquire(source,{})
        self.assertEqual(report['pollMinSeconds'],1800); self.assertEqual(features[0].properties['startsAt'],'2013-04-17T16:13:50Z'); self.assertTrue(features[0].source_id.startswith('event-fallback-'))

    def test_dc_drops_timestamp_without_offset(self):
        body=b'<rss><channel><item><title>No zone</title><link>https://calendar.dc.gov/event/no-zone</link><pubDate>Wed, 17 Apr 2013 16:13:50</pubDate></item></channel></rss>'
        source=SourceConfig.from_dict({'id':'dc','name':'DC Calendar','provider':'dc_rss_events','url':'https://calendar.dc.gov/node/all/events','domains':['event'],'licenseUrl':'https://oca.dc.gov/page/agency-data-terms-use'})
        with patch('app.pipeline.adapters.dc_rss_events.urlopen',return_value=Response(body,{'Cache-Control':'public, max-age=1800'})):
            features, report=DcRssEventsProvider().acquire(source,{})
        self.assertEqual(features, []); self.assertEqual(report['acceptedCount'],0)
