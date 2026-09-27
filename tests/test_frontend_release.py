import json
from gremlin_acquisition.frontend_release import promote, rollback


def test_frontend_promotion_requires_approved_review_and_explicit_ids(tmp_path):
    review = tmp_path / "review.json"
    review.write_text(json.dumps({"packageId": "review-1", "status": "APPROVED", "coverage": {"geographyId": "city-1", "requiredCategories": ["park"]}, "records": [{"record": {"record_id": "p1", "name": "Park", "category": "park", "source_url": "https://x.gov", "latitude": 1, "longitude": 2, "attributes": {}}}]}))
    audit = tmp_path / "audit.jsonl"
    payload, path, publication = promote(review, ["p1"], "supabase-approval-1", tmp_path / "frontend", audit_path=audit)
    assert payload["schema"] == "motherbird-regional-package.v1"
    assert json.loads(path.read_text())["places"][0]["id"] == "p1"
    assert publication is None
    assert json.loads(audit.read_text().splitlines()[0])["selectedRecordIds"] == ["p1"]


def test_frontend_rollback_requires_exact_active_id(tmp_path):
    row = rollback("pkg-1", "pkg-1", tmp_path / "audit.jsonl")
    assert row["preserveLaterPromotions"] is True


def test_frontend_publication_manifest_is_idempotent_and_rolls_back_exactly(tmp_path):
    review_dir = tmp_path / "review"
    publish_dir = tmp_path / "published"
    review = review_dir / "review.json"
    review_dir.mkdir()
    review.write_text(json.dumps({"packageId": "pkg-1", "status": "APPROVED", "coverage": {"geographyId": "city-1", "requiredCategories": ["park"]}, "records": [{"record": {"record_id": "p1", "name": "Park", "category": "park", "source_url": "https://x.gov", "latitude": 1, "longitude": 2, "attributes": {}}}]}))
    promote(review, ["p1"], "approval-1", tmp_path / "artifacts", publish_dir)
    assert json.loads((publish_dir / "active.json").read_text())["activePackageId"] == "pkg-1"
    review.write_text(json.dumps({"packageId": "pkg-2", "status": "APPROVED", "coverage": {"geographyId": "city-1", "requiredCategories": ["trail"]}, "records": [{"record": {"record_id": "p2", "name": "Trail", "category": "trail", "source_url": "https://x.gov", "latitude": 1, "longitude": 2, "attributes": {}}}]}))
    promote(review, ["p2"], "approval-2", tmp_path / "artifacts", publish_dir)
    row = rollback("pkg-2", "pkg-2", tmp_path / "audit.jsonl", publish_dir)
    assert row["restoredPackageId"] == "pkg-1"
