from gremlin_acquisition.package_intelligence import FeatureRequirement, RegionalNeed
from gremlin_acquisition.source_search import (
    SearchResult, SearchLine, candidate_source_configs, classify_search_result, generate_search_lines, search_feedback,
)
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.planner import AcquisitionPlanner


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


def test_search_results_become_deduplicated_https_source_candidates():
    candidates = candidate_source_configs([
        SearchResult('park query', 'catalog-search', 'ok', ('https://city.gov/parks/', 'http://unsafe.example/park'), ('park',)),
        SearchResult('trail query', 'catalog-search', 'ok', ('https://city.gov/parks',), ('trail',)),
    ])
    assert candidates == [{
        'provider': 'catalog-search',
        'url': 'https://city.gov/parks',
        'domains': ['park', 'trail'],
        'discoveredFrom': 'park query',
        'discoveryReason': 'search result classified as successful',
    }]


def test_planner_persists_each_search_outcome_without_fetching_sources(tmp_path):
    need = RegionalNeed("New City", "new-city", (FeatureRequirement("parks"),))
    class Adapter:
        name = "replay-search"
        def search(self, line: SearchLine):
            return SearchResult(line.query, self.name, "ok", ("https://city.gov/parks",), (line.category,), "official catalog")
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    results = AcquisitionPlanner(ledger=ledger).search_sources("search-1", need, Adapter(), max_lines=1)
    assert results[0].status == "SUCCEEDED"
    assert ledger.search_feedback[0]["outcome"] == "SUCCEEDED"
    assert "city.gov" in ledger.search_feedback[0]["notes"]
