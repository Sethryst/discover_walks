from gremlin_acquisition.package_intelligence import (
    FeatureRequirement, POIRecord, RegionalNeed, coverage_report,
    deduplicate_pois, diff_pois, validate_poi,
    load_region_needs, need_from_region_config,
    discover_regions,
    needs_from_discoveries,
)
from gremlin_acquisition.models import Geography
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.planner import AcquisitionPlanner


def poi(record_id, name, category="parks", lat=45.5, lon=-122.6):
    return POIRecord(record_id, name, category, "https://city.example/places", lat, lon)


def test_frontend_requirements_translate_and_report_gaps():
    need = RegionalNeed("Example City", "city-1", (
        FeatureRequirement("parks"), FeatureRequirement("libraries"),
        FeatureRequirement("news", required=False, minimum_records=0, frontend_surface="news"),
    ))
    report = coverage_report(need, [poi("p1", "Central Park")])
    assert report["requiredCategories"] == ["park", "library", "news"]
    assert report["gaps"] == ["library"]


def test_cross_source_deduplication_and_validation():
    records, duplicates = deduplicate_pois([
        poi("a", "Central Park"), poi("b", " Central   Park ", "park")
    ])
    assert len(records) == 1
    assert duplicates
    assert validate_poi(POIRecord("bad", "", "park", "not-a-url", 120, 2)) == [
        "missing name", "invalid source URL", "latitude out of range"
    ]


def test_change_detection_distinguishes_new_missing_and_updated():
    before = [poi("old", "Central Park")]
    current = [poi("old", "Central Park", lat=45.51)]
    result = diff_pois(before, current)
    assert result["updated"] == ["old"]
    assert result["new"] == []
    assert result["missing"] == []


def test_package_planning_records_requirements_and_search_feedback(tmp_path):
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    need = RegionalNeed("Portland", "city-1", (FeatureRequirement("parks"), FeatureRequirement("libraries")))
    class Geo:
        def resolve(self, query):
            return __import__('gremlin_acquisition.models', fromlist=['Geography']).Geography('city-1', query, 'city')
        def neighbors(self, geography): return []
    planner = AcquisitionPlanner(geo=Geo(), ledger=ledger)
    plans = planner.plan_package("run-1", need, max_batches=1)
    assert plans[0].search_lines[0].startswith("official park source")
    assert ledger.decisions[0]["requirement_categories"] == ["park", "library"]
    ledger.record_search_feedback("run-1", "city-1", "official parks", "succeeded", ["park"])
    assert ledger.search_feedback[0]["categories_found"] == ["park"]

def test_planner_enforces_recent_failure_cooldown(tmp_path):
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    ledger.record_attempt("prior", "city-1", "https://failed.example", "geojson", "failed")
    need = RegionalNeed("Portland", "city-1", (FeatureRequirement("parks"),))
    class Geo:
        def resolve(self, query): return Geography("city-1", query, "city")
        def neighbors(self, geography): return [Geography("city-2", "Neighbor", "city")]
    plans = AcquisitionPlanner(geo=Geo(), ledger=ledger).plan_package("next", need, max_batches=2)
    assert [plan.geography.id for plan in plans] == ["city-2"]
    assert any("cooldown" in decision["reason"] for decision in ledger.decisions)


def test_region_requirements_are_derived_from_app_config():
    need = need_from_region_config({
        "id": "new-region", "name": "New Region",
        "osm": {"categories": ["park", "coffee"]},
        "sources": [{"domains": ["trails"], "propertyMapping": {"constants": {"type": "library"}}}],
    })
    assert need.geography_id == "new-region"
    assert [r.canonical_category for r in need.requirements] == ["coffee", "library", "park", "trail"]


def test_existing_region_configs_can_be_loaded():
    needs = load_region_needs("app/regions")
    ids = {need.geography_id for need in needs}
    assert "portland" in ids
    assert "fairfax-county-va" in ids
    assert all(need.discovered_from == "app/regions configuration" for need in needs)


def test_region_discovery_only_accepts_unique_canonical_identities():
    class Adapter:
        def resolve(self, query):
            return {
                "New City": Geography("city-new", "New City", "city"),
                "Known City": Geography("city-known", "Known City", "city"),
                "Maybe City": Geography("", "Maybe City", "ambiguous"),
            }.get(query, Geography("", query, "unresolved"))

    rows = discover_regions(["New City", "Known City", "Maybe City", "Unknown"], Adapter(), {"city-known"})
    assert [(row.query, row.status) for row in rows] == [
        ("New City", "NEW"), ("Known City", "KNOWN"),
        ("Maybe City", "AMBIGUOUS"), ("Unknown", "UNRESOLVED"),
    ]
    needs = needs_from_discoveries(rows)
    assert [need.geography_id for need in needs] == ["city-new"]
    assert {requirement.frontend_surface for requirement in needs[0].requirements} >= {"explore", "learn", "news", "cuisine"}
