from gremlin_acquisition.package_intelligence import FeatureRequirement, POIRecord, RegionalNeed
from gremlin_acquisition.review_package import build_review_package, validate_review_package, write_review_package
from gremlin_acquisition.ledger import AcquisitionLedger


def test_review_package_is_content_addressed_and_explains_quality():
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    record = POIRecord("p1", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6)
    first = build_review_package(need, [record], ["https://city.gov/parks"])
    second = build_review_package(need, [record], ["https://city.gov/parks"])
    assert first == second
    assert first["packageId"]
    assert first["records"][0]["quality"]["frontend_fit"] == 1.0
    assert first["coverage"]["gaps"] == []
    assert validate_review_package(first) == []


def test_review_package_keeps_invalid_records_out_of_accepted_output():
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    record = POIRecord("bad", "", "parks", "not-a-url")
    package = build_review_package(need, [record])
    assert package["records"] == []
    assert package["rejected"][0]["recordId"] == "bad"
    assert package["rejected"][0]["quality"]["total"] < 0.6


def test_review_package_writer_rejects_malformed_schema(tmp_path):
    import pytest
    with pytest.raises(ValueError, match='invalid review package'):
        write_review_package({'schema': 'wrong'}, tmp_path)


def test_review_coverage_counts_delivered_records_not_rejected_candidates():
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"), FeatureRequirement("libraries")))
    package = build_review_package(need, [
        POIRecord("park", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6),
        POIRecord("library", "Central Library", "libraries", "not-a-url", 45.5, -122.6),
    ])
    assert package["coverage"]["counts"] == {"park": 1, "library": 0}
    assert package["coverage"]["gaps"] == ["library"]
    assert package["candidateCoverage"]["gaps"] == []


def test_review_package_requires_explicit_approval_before_promotion(tmp_path):
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    package = build_review_package(need, [POIRecord("p1", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6)])
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    row = ledger.record_review_package(package)
    assert row["status"] == "READY FOR REVIEW"
    import pytest
    with pytest.raises(ValueError): ledger.mark_package_promoted(package["packageId"], "release-1")
    approved = ledger.approve_review_package(package["packageId"], "moderator-1", "supabase-approval-1")
    assert approved["status"] == "APPROVED"
    promoted = ledger.mark_package_promoted(package["packageId"], "pages-commit-1")
    assert promoted["status"] == "PROMOTED"
    reopened = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    assert reopened.review_packages[0]["approval"]["actor"] == "moderator-1"
    assert [row["state"] for row in reopened.package_transitions] == ["READY FOR REVIEW", "APPROVED", "PROMOTED"]


def test_artifact_lifecycle_metadata_is_explicit_and_non_authorizing(tmp_path):
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    package = build_review_package(need, [POIRecord("p1", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6)])
    path = write_review_package(package, tmp_path)
    import json
    saved = json.loads(path.read_text())
    assert saved["status"] == "READY FOR REVIEW"
    assert saved["approval"] is None and saved["publication"] is None

def test_record_selection_is_separate_and_audited(tmp_path):
    import pytest
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    package = build_review_package(need, [POIRecord("p1", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6)])
    ledger = AcquisitionLedger(tmp_path / "selection.sqlite3")
    ledger.record_review_package(package)
    selected = ledger.record_package_selection(package["packageId"], ["p1"], "reviewer-1", "selection-1")
    assert selected["selection"]["recordIds"] == ["p1"]
    assert any(row["state"] == "RECORDS SELECTED" for row in ledger.package_transitions)
    with pytest.raises(ValueError): ledger.record_package_selection(package["packageId"], ["missing"], "reviewer-1", "selection-2")


def test_kpi_summary_reports_package_state_and_gaps(tmp_path):
    from gremlin_acquisition.kpi import summarize
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"), FeatureRequirement("libraries")))
    package = build_review_package(need, [POIRecord("p1", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6)])
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    ledger.record_review_package(package)
    report = summarize(ledger)
    assert report["package_counts"]["READY FOR REVIEW"] == 1
    assert report["package_coverage_gaps"] == ["library"]
