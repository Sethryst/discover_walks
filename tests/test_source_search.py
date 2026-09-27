from gremlin_acquisition.package_intelligence import FeatureRequirement, RegionalNeed
from gremlin_acquisition.source_search import (
    SearchResult, classify_search_result, generate_search_lines, search_feedback,
)


def test_search_lines_are_deterministic_and_frontend_aware():
    need = RegionalNeed("New City", "new-city", (FeatureRequirement("parks", frontend_surface="explore"),))
    lines = generate_search_lines(need)
    assert [line.query for line in lines] == [
        '"New City" park official data', '"New City" park calendar', '"New City" park map'
    ]
    assert all(line.frontend_surface == "explore" for line in lines)


def test_search_results_normalize_and_record_feedback():
    result = classify_search_result(SearchResult(
        '"New City" park map', "provider", "ok",
        ("https://www.City.gov/parks", "https://city.gov/parks"), ("park", "park"),
    ))
    assert result.status == "SUCCEEDED"
    feedback = search_feedback(result)
    assert feedback["domains"] == ["city.gov"]
    assert feedback["categories_found"] == ["park"]


def test_search_failures_remain_distinct():
    assert classify_search_result(SearchResult("q", "p", "timeout")).status == "TEMPORARY FAILURE"
    assert classify_search_result(SearchResult("q", "p", "empty")).status == "EMPTY"
    assert classify_search_result(SearchResult("q", "p", "duplicate")).status == "DUPLICATE SOURCE"
