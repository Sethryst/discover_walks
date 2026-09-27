import json
from gremlin_acquisition.frontend_release import promote, rollback


def test_frontend_promotion_requires_approved_review_and_explicit_ids(tmp_path):
    review = tmp_path / "review.json"
    review.write_text(json.dumps({"packageId": "review-1", "status": "APPROVED", "records": [{"record": {"record_id": "p1", "name": "Park", "category": "park", "source_url": "https://x.gov", "latitude": 1, "longitude": 2, "attributes": {}}}]}))
    payload, path = promote(review, ["p1"], "supabase-approval-1", tmp_path / "frontend")
    assert payload["schema"] == "motherbird-regional-package.v1"
    assert json.loads(path.read_text())["places"][0]["id"] == "p1"


def test_frontend_rollback_requires_exact_active_id(tmp_path):
    row = rollback("pkg-1", "pkg-1", tmp_path / "audit.jsonl")
    assert row["preserveLaterPromotions"] is True
