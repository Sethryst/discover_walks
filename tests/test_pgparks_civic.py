import unittest
from datetime import datetime, timezone

from app.pipeline.pgparks_civic import cards_from_payload


class PgParksCivicTests(unittest.TestCase):
    def test_free_event_is_enriched_with_public_venue_address(self) -> None:
        payload = {"events": [{"id": 9, "title": "Free exhibit", "url": "https://example.gov/event", "start_date": "2026-08-08 10:00:00", "end_date": "2026-08-08 16:00:00", "cost": "Free", "categories": [], "description": "A free exhibit."}]}
        detail = {"@type": "Event", "description": "A source-backed exhibition.", "location": {"name": "Museum", "address": {"streetAddress": "1 Main St", "addressLocality": "Laurel", "addressRegion": "MD"}}}
        cards = cards_from_payload(payload, datetime(2026, 8, 6, tzinfo=timezone.utc), lambda _: detail)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["venueAddress"], "1 Main St, Laurel, MD")

    def test_paid_or_addressless_events_are_withheld(self) -> None:
        payload = {"events": [{"id": 10, "title": "Paid", "url": "https://example.gov/event", "start_date": "2026-08-08 10:00:00", "cost": "$12"}]}
        self.assertEqual(cards_from_payload(payload, datetime(2026, 8, 6, tzinfo=timezone.utc), lambda _: None), [])

    def test_free_event_without_structured_venue_is_kept_with_explicit_fallback(self) -> None:
        payload = {"events": [{"id": 11, "title": "Movie @ Fairwood Park", "url": "https://example.gov/event", "start_date": "2026-08-08 10:00:00", "end_date": "2026-08-08 16:00:00", "cost": "Free"}]}
        cards = cards_from_payload(payload, datetime(2026, 8, 6, tzinfo=timezone.utc), lambda _: {"@type": "Event"})
        self.assertEqual(cards[0]["locationLabel"], "Fairwood Park")
