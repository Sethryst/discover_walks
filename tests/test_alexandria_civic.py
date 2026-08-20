from datetime import datetime, timezone
import unittest

from app.pipeline.alexandria_civic import cards_from_feed


class AlexandriaCivicTests(unittest.TestCase):
    def test_public_meeting_rss_has_location_and_excludes_pool_hours(self):
        feed = b'''<rss><channel><item><title>Planning Commission - Thu Aug 20, 2026 19:00</title><link>https://apps.alexandriava.gov/Calendar/Detail.aspx?si=42</link><description>Location: City Hall&lt;br /&gt;Tags: Boards &amp;amp; Commissions</description></item><item><title>Pool Open - Thu Aug 20, 2026 06:00</title><link>https://apps.alexandriava.gov/Calendar/Detail.aspx?si=43</link><description>Tags: CityPoolHours</description></item></channel></rss>'''
        cards = cards_from_feed(feed, datetime(2026, 8, 1, tzinfo=timezone.utc))
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["locationLabel"], "City Hall")
