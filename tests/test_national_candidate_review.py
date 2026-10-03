import json

from app.scout.national_candidate_review import review_package


def test_review_separates_machine_readable_channels_and_reruns():
    result = review_package({"candidates": [
        {"id": "rss", "url": "https://city.gov/rss/events", "dataType": "RSS/Atom"},
        {"id": "html", "url": "https://city.gov/events", "dataType": "HTML calendar"},
        {"id": "generic", "url": "https://city.gov/parks", "dataType": "HTML calendar"},
    ], "active": False})
    assert result["summary"] == {"reviewed": 3, "researchReady": 1, "needsHumanReview": 1, "rejected": 1, "rerunCandidates": 2, "quarantined": 1}
    assert result["publicationState"] == "research-only"
    assert result["active"] is False
    assert result["rerunQueue"][0]["url"].endswith("rss/events")
    assert all(not item["url"].endswith("/rss/events") for item in result["rerunQueue"] if item["priority"] == 2)


def test_review_is_deterministic_except_timestamp():
    package = {"candidates": [{"id": "x", "url": "https://city.gov/rss", "dataType": "RSS/Atom"}]}
    a = review_package(package, reviewed_at="2026-01-01T00:00:00Z")
    b = review_package(package, reviewed_at="2026-01-01T00:00:00Z")
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
