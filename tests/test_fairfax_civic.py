from datetime import datetime, timezone
import unittest

from app.pipeline.fairfax_civic import cards_from_feed


class FairfaxCivicTests(unittest.TestCase):
    def test_rss_items_are_enriched_only_with_official_detail_fields(self):
        feed = b"<rss><channel><item><title>Electoral Board Meeting</title><link>http://www.fairfaxcounty.gov/Calendar/?C=1&amp;Event=48063</link></item></channel></rss>"
        detail = "<tr><td><b>Event Date</b>:</td><td> Thursday, August 20, 2026 </td></tr><tr><td><b>Time</b>:</td><td>4:00 PM</td></tr><tr><td><b>Location</b>:</td><td>Fairfax County Government Center<br/>12000 Government Center Parkway</td></tr>"
        cards = cards_from_feed(feed, datetime(2026, 8, 1, tzinfo=timezone.utc), lambda _: detail)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["date"], "2026-08-20")
        self.assertIn("Government Center", cards[0]["locationLabel"])
        self.assertTrue(cards[0]["officialUrl"].startswith("https://"))

    def test_items_without_a_verifiable_date_are_omitted(self):
        feed = b"<rss><channel><item><title>Meeting</title><link>http://www.fairfaxcounty.gov/Calendar/?C=1&amp;Event=1</link></item></channel></rss>"
        self.assertEqual(cards_from_feed(feed, datetime(2026, 8, 1, tzinfo=timezone.utc), lambda _: ""), [])
