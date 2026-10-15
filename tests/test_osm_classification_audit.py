import json
from pathlib import Path

from app.pipeline.normalization import classify_osm_place, normalize_overpass
from app.pipeline.osm_classification_audit import audit_osm_file


def test_historic_house_is_history_site_with_evidence():
    category, subcategory, evidence = classify_osm_place({"name": "Old Mill Historic House"})
    assert category == "history"
    assert subcategory == "historic_site"
    assert evidence["confidence"] == "high"


def test_ambiguous_name_remains_reviewable_community():
    category, subcategory, evidence = classify_osm_place({"name": "Washington Square"})
    assert (category, subcategory) == ("community", None)
    assert evidence["confidence"] == "review"


def test_normalization_preserves_osm_provenance_and_promotes_strong_signal():
    pois, warnings = normalize_overpass([{"type": "node", "id": 7, "lat": 38.8, "lon": -77.0, "tags": {"name": "Memorial House"}}], source_config_id="osm-test", retrieved_at="2026-10-15T00:00:00Z")
    assert not warnings
    assert pois[0]["category"] == "history"
    assert pois[0]["subcategory"] == "historic_site"
    assert pois[0]["source"][0]["id"] == "osm-test"
    assert pois[0]["tags"] == ["history", "osm"]


def test_audit_report_separates_change_and_review(tmp_path: Path):
    path = tmp_path / "osm.json"
    path.write_text(json.dumps({"pois": [
        {"id": "osm:node:1", "name": "Historic Manor", "category": "community", "tags": ["community", "osm"], "fromOsm": True, "source": {"name": "OpenStreetMap"}},
        {"id": "osm:node:2", "name": "Blue Point", "category": "community", "tags": ["community", "osm"], "fromOsm": True, "source": {"name": "OpenStreetMap"}},
    ]}), encoding="utf-8")
    report = audit_osm_file(path)
    assert report["totalOsmPointsReviewed"] == 2
    assert report["pointsNeedingNewCategory"] == 1
    assert report["pointsIntentionallyUncategorized"] == 1
    assert report["proposedChanges"][0]["proposedCategory"] == "history"
