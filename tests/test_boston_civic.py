import unittest
from datetime import datetime

from app.pipeline.boston_civic import cards_from_html


class BostonCivicTests(unittest.TestCase):
    def test_free_city_event_keeps_date_time_and_address(self) -> None:
        page = '''<h2 class="listing-group-title">August 8, 2026</h2><article id="node-9" class=" calendar-listing-wrapper"><span class="time-range">10:00am-12:00pm</span><div class="title">Free workshop</div><div itemprop="streetAddress">1 Main St</div><span class="locality">Boston</span><span class="postal-code">02108</span><div class="dl-t">Price:</div><div class="detail-item__body--secondary dl-d">FREE</div><div class="description"><p>A public program.</p></div></article>'''
        cards = cards_from_html(page, datetime(2026, 8, 6).astimezone())
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["venueAddress"], "1 Main St, Boston, MA, 02108")
        self.assertEqual(cards[0]["startsAt"], "2026-08-08T10:00:00-04:00")

    def test_non_free_and_expired_events_are_withheld(self) -> None:
        page = '''<h2 class="listing-group-title">August 5, 2026</h2><article id="node-10" class="calendar-listing-wrapper"><div class="title">Paid event</div><div class="dl-t">Price:</div><div class="dl-d">$10</div></article>'''
        self.assertEqual(cards_from_html(page, datetime(2026, 8, 6).astimezone()), [])

    def test_far_future_event_is_withheld(self) -> None:
        page = '''<h2 class="listing-group-title">December 8, 2026</h2><article id="node-11" class="calendar-listing-wrapper"><div class="title">Free later event</div><div class="dl-t">Price:</div><div class="dl-d">FREE</div></article>'''
        self.assertEqual(cards_from_html(page, datetime(2026, 8, 6).astimezone()), [])
