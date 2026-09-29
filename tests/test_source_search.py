from gremlin_acquisition.package_intelligence import FeatureRequirement, RegionalNeed
from gremlin_acquisition.source_search import (
    SearchResult, SearchLine, candidate_source_configs, classify_search_result, discover_ogc_collections, generate_search_lines, governed_config_from_candidate, governed_source_proposals, infer_provider, search_feedback,
)
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.planner import AcquisitionPlanner


def test_search_lines_are_deterministic_and_frontend_aware():
    need = RegionalNeed("New City", "new-city", (FeatureRequirement("parks", frontend_surface="explore"),))
    lines = generate_search_lines(need)
    assert len(lines) == 13
    assert lines[0].query == '"New City" park official data'
    assert all(line.frontend_surface == "explore" for line in lines)


def test_provider_inference_routes_discovered_urls_to_adapters():
    assert infer_provider('https://city.gov/calendar/events.ics') == 'icalendar'
    assert infer_provider('https://gis.gov/rest/services/Parks/FeatureServer/0') == 'arcgis_feature_service'
    assert infer_provider('https://data.gov/collections/parks/items') == 'ogc_records'
    assert infer_provider('https://data.gov/resource/abc.json') == 'socrata'


def test_multi_region_discovery_selects_adapters_without_manual_labels():
    results = [
        SearchResult('portland event', '', 'ok', ('https://portland.gov/events.ics',), ('event',)),
        SearchResult('denver parks', '', 'ok', ('https://denver.gov/rest/services/Parks/FeatureServer/0',), ('park',)),
        SearchResult('seattle catalog', '', 'ok', ('https://seattle.gov/collections/parks/items',), ('park',)),
        SearchResult('chicago open data', '', 'ok', ('https://data.chicago.gov/resource/parks.json',), ('park',)),
    ]
    candidates = candidate_source_configs(results)
    assert [row['provider'] for row in candidates] == [
        'socrata', 'arcgis_feature_service', 'icalendar', 'ogc_records'
    ]


def test_discovered_candidate_promotion_requires_provenance_and_preserves_adapter():
    candidate = {'provider': 'icalendar', 'url': 'https://portland.gov/events.ics', 'domains': ['event']}
    config = governed_config_from_candidate(
        candidate, license_url='https://portland.gov/terms', authority_tier='city_government')
    assert config['provider'] == 'icalendar'
    assert config['status'] == 'APPROVED'
    try:
        governed_config_from_candidate(candidate, license_url='', authority_tier='unknown')
    except ValueError as exc:
        assert 'required' in str(exc)
    else:
        raise AssertionError('unprovenanceable candidate must not be promoted')


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


def test_source_candidates_become_review_only_governed_proposals():
    proposals = governed_source_proposals([
        SearchResult('park query', 'catalog-search', 'ok', ('https://city.gov/parks',), ('park',), 'official catalog')
    ], 'new-city')
    assert proposals[0]['status'] == 'PROPOSED'
    assert proposals[0]['binding']['kind'] == 'region-source'
    assert proposals[0]['publication'] == 'not authorized'
    assert proposals[0]['evidence']['query'] == 'park query'


def test_ogc_collection_discovery_preserves_license_evidence():
    rows = discover_ogc_collections({'collections': [{
        'id': 'parks', 'title': 'Portland Parks', 'description': 'Official parks',
        'links': [{'rel': 'items', 'href': 'https://catalog.example/collections/parks/items'},
                  {'rel': 'license', 'href': 'https://city.gov/license'}],
    }]}, 'https://catalog.example/api/search/v1', default_domains=('park',), authority_tier='city_government')
    assert rows[0]['provider'] == 'ogc_records'
    assert rows[0]['licenseUrl'] == 'https://city.gov/license'
    assert rows[0]['authorityTier'] == 'city_government'


def test_approved_ogc_proposal_keeps_license_in_governed_config(tmp_path):
    ledger = AcquisitionLedger(tmp_path / 'ledger.sqlite3')
    proposal = {
        'id': 'ogc-parks', 'status': 'PROPOSED', 'geographyId': 'portland',
        'sourceId': 'parks', 'provider': 'ogc_records',
        'url': 'https://catalog.example/collections/parks/items', 'domains': ['park'],
        'licenseUrl': 'https://city.gov/license', 'title': 'Portland Parks',
    }
    ledger.record_source_proposal('run-1', proposal)
    ledger.approve_source_proposal('ogc-parks', 'reviewer', 'approval-1')
    config = ledger.governed_source_config('ogc-parks')
    assert config['licenseUrl'] == 'https://city.gov/license'
    assert config['title'] == 'Portland Parks'


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


def test_source_proposals_are_restart_safe_and_remain_proposed(tmp_path):
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    proposal = {
        'id': 'discovered-1', 'status': 'PROPOSED', 'geographyId': 'new-city',
        'sourceId': 'source-1', 'provider': 'geojson', 'url': 'https://city.gov/parks',
        'domains': ['park'], 'binding': {'kind': 'region-source'},
        'evidence': {'query': 'park query'}, 'publication': 'not authorized',
    }
    ledger.record_source_proposal('run-1', proposal)
    reopened = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    assert reopened.source_proposals[0]['status'] == 'PROPOSED'
    assert reopened.source_proposals[0]['publication'] == 'not authorized'


def test_source_proposal_approval_is_explicit_and_restart_safe(tmp_path):
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    proposal = {
        'id': 'discovered-2', 'status': 'PROPOSED', 'geographyId': 'new-city',
        'sourceId': 'source-2', 'provider': 'geojson', 'url': 'https://city.gov/trails',
        'domains': ['trail'], 'binding': {'kind': 'region-source'},
        'evidence': {'query': 'trail query'}, 'publication': 'not authorized',
    }
    ledger.record_source_proposal('run-2', proposal)
    import pytest
    with pytest.raises(ValueError): ledger.approve_source_proposal('discovered-2', '', '')
    with pytest.raises(ValueError): ledger.governed_source_config('discovered-2')
    approved = ledger.approve_source_proposal('discovered-2', 'moderator-1', 'supabase-source-approval-1')
    assert approved['status'] == 'APPROVED'
    governed = ledger.governed_source_config('discovered-2')
    assert governed['status'] == 'GOVERNED CONFIG PROPOSED'
    assert governed['proposalId'] == 'discovered-2'
    reopened = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    assert reopened.source_proposals[0]['approval']['reference'] == 'supabase-source-approval-1'
    assert [row['state'] for row in reopened.source_proposal_transitions] == ['PROPOSED', 'APPROVED', 'GOVERNED CONFIG PROPOSED']
