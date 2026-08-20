import unittest
from datetime import datetime, timezone

from app.pipeline.philly_civic import cards_from_html


class PhillyCivicTests(unittest.TestCase):
    def test_official_listing_preserves_address_without_geocoding(self) -> None:
        page = '''<li class="simcal-event simcal-event-has-location" data-open="abc"><span class="simcal-event-title" itemprop="name">Street fair</span><span itemprop="startDate" content="2026-08-08T11:00:00-04:00"></span><span itemprop="endDate" content="2026-08-08T17:00:00-04:00"></span><meta itemprop="address" content="1 Market St; Philadelphia, PA 19106" /></li>'''
        cards = cards_from_html(page, datetime(2026, 8, 6, tzinfo=timezone.utc))
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["venueAddress"], "1 Market St; Philadelphia, PA 19106")
