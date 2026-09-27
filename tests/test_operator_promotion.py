import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pipeline.operator_promotion import build_report, fetch_approvals


class OperatorPromotionTests(unittest.TestCase):
    def test_secret_key_authenticates_without_bearer_jwt(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SECRET_KEY": "sb_secret_test"}, clear=True), patch("app.pipeline.operator_promotion.urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value = b'[]'
            self.assertEqual(fetch_approvals(), [])
        headers = dict(request.call_args.args[0].header_items())
        self.assertEqual(headers["Apikey"], "sb_secret_test")
        self.assertNotIn("Authorization", headers)

    def test_approved_source_becomes_promotion_ready_only_after_url_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            queue = {"regions": [{"queue": [{"id": "source-1", "publisher": "City", "url": "https://example.org/events", "category": "events", "likelyDataType": "ics", "classification": "INVESTIGATE"}]}]}
            (root / "expansion-queues").mkdir()
            (root / "expansion-queues" / "regional-source-backlog.json").write_text(json.dumps(queue), encoding="utf-8")
            approvals = [{"source_id": "source-1", "updated_at": "2026-09-27T00:00:00Z"}]
            with patch("app.pipeline.operator_promotion.ROOT", root), patch("app.pipeline.operator_promotion.fetch_approvals", return_value=approvals), patch("app.pipeline.operator_promotion.check_url", return_value={"status": "pass", "httpStatus": 200, "contentType": "text/html"}), patch("app.pipeline.operator_promotion.extract_events", return_value=[{"title": "Event", "startsAt": "2026-10-01", "coordinates": [-75, 40]}]):
                report = build_report()
        self.assertEqual(report["promotionReadyCount"], 1)
        self.assertEqual(report["rows"][0]["freeOrAccessible"], "manual-review-required")


if __name__ == "__main__":
    unittest.main()
