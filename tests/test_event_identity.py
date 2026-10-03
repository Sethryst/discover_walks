import unittest
from app.pipeline.event_identity import fallback_event_id


class EventIdentityTests(unittest.TestCase):
    def test_fallback_id_is_deterministic_and_normalized(self):
        a = fallback_event_id("https://example.gov/event/1/", "  Park   Walk ", "2026-09-30T10:00:00Z", "Main Park")
        b = fallback_event_id("https://example.gov/event/1", "park walk", "2026-09-30T10:00:00Z", "Main Park")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("event-fallback-"))


if __name__ == "__main__": unittest.main()
