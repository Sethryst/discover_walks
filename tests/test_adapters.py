from gremlin_acquisition.adapters import acquire, acquire_with_fallback
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.package_intelligence import FeatureRequirement, RegionalNeed


def test_arcgis_adapter_normalizes_categories_and_coordinates():
    config = {"provider": "arcgis_feature_service", "url": "https://city.gov/parks", "domains": ["parks"], "propertyMapping": {"id": "OBJECTID", "name": "PARK_NAME", "include": ["ACRES"]}}
    body = '{"objectIdFieldName":"OBJECTID","features":[{"attributes":{"OBJECTID":7,"PARK_NAME":"Central Park","ACRES":12},"geometry":{"x":-122.6,"y":45.5}}]}'
    result = acquire(config, lambda _: body)
    assert result.status == "SUCCEEDED"
    assert result.records[0].canonical_category == "park"
    assert result.records[0].latitude == 45.5 and result.records[0].longitude == -122.6


def test_geojson_adapter_preserves_validation_errors():
    config = {"url": "https://city.gov/places", "domains": ["libraries"], "propertyMapping": {"id": "id", "name": "name"}}
    body = '{"features":[{"type":"Feature","properties":{"id":"x","name":"Library"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}},{"type":"Feature","properties":{"id":"bad"},"geometry":null}]}'
    result = acquire(config, lambda _: body)
    assert result.status == "PARTIAL"
    assert any("missing name" in error for error in result.errors)


def test_ledger_ingestion_persists_coverage_duplicates_and_changes(tmp_path):
    config = {"url": "https://city.gov/places", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}}
    body = '{"features":[{"type":"Feature","properties":{"id":"x","name":"Central Park"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}},{"type":"Feature","properties":{"id":"x2","name":"Central Park"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}}]}'
    result = acquire(config, lambda _: body)
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    report = ledger.ingest_pois("run-1", need, result)
    assert report["recordCount"] == 1
    assert report["duplicateCount"] == 1
    assert report["gaps"] == []
    assert ledger.poi_transitions[0]["state"] == "new"
    reopened = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    assert len(reopened.pois) == 1 and len(reopened.coverage) == 1

def test_acquisition_pipeline_returns_review_only_package_after_fallback(tmp_path):
    from gremlin_acquisition.pipeline import acquire_review_package
    config = {"url": "https://city.gov/places", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}}
    replacement = {**config, "url": "https://city.gov/replacement"}
    body = '{"features":[{"type":"Feature","properties":{"id":"p1","name":"Central Park"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}}]}'
    def transport(url):
        if url == config["url"]: raise RuntimeError("retired source")
        return body
    ledger = AcquisitionLedger(tmp_path / "pipeline.sqlite3")
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    result = acquire_review_package("run-1", need, [config, replacement], transport, ledger, tmp_path / "packages")
    assert result["fallbackStatus"] == "SUCCEEDED"
    assert result["package"]["coverage"]["gaps"] == []
    assert any("retired source" in evidence for evidence in result["package"]["sourceEvidence"])
    assert any("SUCCEEDED" in evidence for evidence in result["package"]["sourceEvidence"])
    assert ledger.review_packages[0]["status"] == "READY FOR REVIEW"


def test_fallback_preserves_failed_source_and_selects_replacement():
    configs = [
        {"provider": "geojson", "url": "https://old.example/places", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}},
        {"provider": "geojson", "url": "https://new.example/places", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}},
    ]
    body = '{"features":[{"type":"Feature","properties":{"id":"p1","name":"New Park"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}}]}'
    def transport(url):
        if "old" in url:
            raise TimeoutError("old source timed out")
        return body
    result = acquire_with_fallback(configs, transport)
    assert result.status == "SUCCEEDED"
    assert len(result.attempts) == 2
    assert result.attempts[0].status == "FAILED"
    assert result.selected.source_url == "https://new.example/places"


def test_ledger_ingest_fallback_persists_attempts_but_only_selected_records(tmp_path):
    configs = [
        {"provider": "geojson", "url": "https://old.example/places", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}},
        {"provider": "geojson", "url": "https://new.example/places", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}},
    ]
    body = '{"features":[{"type":"Feature","properties":{"id":"p1","name":"New Park"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}}]}'
    result = acquire_with_fallback(configs, lambda url: (_ for _ in ()).throw(TimeoutError("old")) if "old" in url else body)
    ledger = AcquisitionLedger(tmp_path / "ledger.sqlite3")
    need = RegionalNeed("Example City", "city-1", (FeatureRequirement("parks"),))
    report = ledger.ingest_fallback("run-1", need, result)
    assert report["attemptCount"] == 2
    assert len(ledger.attempts) == 2
    assert len(ledger.pois) == 1
