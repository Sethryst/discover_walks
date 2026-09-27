from gremlin_acquisition.frontend_package import add_frontend_projection, to_frontend_place, build_selected_frontend_package
from gremlin_acquisition.package_intelligence import POIRecord


def test_frontend_projection_preserves_evidence_and_candidate_state():
    record = POIRecord("p1", "Central Park", "parks", "https://city.gov/parks", 45.5, -122.6, attributes={"amenities": ["restroom"]})
    place = to_frontend_place(record)
    assert place["id"] == "p1"
    assert place["category"] == "park"
    assert place["coordinates"] == [-122.6, 45.5]
    assert place["publishingState"] == "candidate"
    assert place["source"] == "https://city.gov/parks"


def test_frontend_projection_excludes_rejected_records():
    package = {"records": [{"record": {"record_id": "p1", "name": "Park", "category": "park", "source_url": "https://x.gov", "latitude": 1, "longitude": 2, "attributes": {}}}], "rejected": [{"recordId": "bad"}]}
    projected = add_frontend_projection(package)
    assert projected["frontendSchema"] == "motherbird-place.v1"
    assert [row["id"] for row in projected["places"]] == ["p1"]


def test_frontend_publication_requires_approval_and_explicit_selection():
    package = {"packageId": "pkg-1", "status": "APPROVED", "records": [{"record": {"record_id": "p1", "name": "Park", "category": "park", "source_url": "https://x.gov", "latitude": 1, "longitude": 2, "attributes": {}}}]}
    import pytest
    with pytest.raises(ValueError): build_selected_frontend_package({**package, "status": "READY FOR REVIEW"}, ["p1"], approval_reference="a1")
    with pytest.raises(ValueError): build_selected_frontend_package(package, ["missing"], approval_reference="a1")
    result = build_selected_frontend_package(package, ["p1"], approval_reference="a1")
    assert result["schema"] == "motherbird-regional-package.v1"
    assert [place["id"] for place in result["places"]] == ["p1"]
