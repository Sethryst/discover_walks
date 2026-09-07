import json
import tempfile
from pathlib import Path

from app.pipeline.osm_state import (
    POI_EXPRESSIONS,
    STATES,
    atomic_json,
    geometry_bbox,
    normalize_poi_feature,
    resolve_state,
    sha256_file,
    strict_poi_match,
    validate_pmtiles,
)


def test_state_catalog_includes_stable_state_and_equivalent_ids():
    assert len(STATES) == 56
    virginia = resolve_state("Virginia")
    assert (virginia.id, virginia.code, virginia.fips) == ("us-va", "VA", "51")
    assert resolve_state("DC").fips == "11"
    assert resolve_state("Puerto Rico").fips == "72"


def test_bbox_comes_from_polygon_coordinates_not_a_catalog_rectangle():
    geometry = {"type": "MultiPolygon", "coordinates": [[[[2, 3], [4, 3], [4, 8], [2, 3]]], [[[10, -1], [11, 0], [10, -1]]]]}
    assert geometry_bbox(geometry) == (2.0, -1.0, 11.0, 8.0)


def test_poi_osmium_filter_has_only_explicit_values():
    assert POI_EXPRESSIONS
    assert all("=" in expression for expression in POI_EXPRESSIONS)
    assert not any(value in "\n".join(POI_EXPRESSIONS) for value in ("restaurant", "fast_food", "supermarket", "convenience"))


def test_poi_second_gate_rejects_broad_and_normalizes_provenance():
    assert strict_poi_match({"amenity": "library"})
    assert not strict_poi_match({"amenity": "restaurant"})
    state = resolve_state("VA")
    feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-77, 38]}, "properties": {"id": 7, "type": "node", "tags": {"name": "Library", "amenity": "library", "phone": "private"}}}
    normalized = normalize_poi_feature(feature, state=state, release="osm-us-test")
    assert normalized["properties"]["osm_id"] == "7"
    assert normalized["properties"]["state"] == "us-va"
    assert "phone" not in normalized["properties"]["tags"]


def test_atomic_json_and_checksum_are_deterministic():
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "manifest.json"
        atomic_json(path, {"b": 2, "a": 1})
        first = sha256_file(path)
        atomic_json(path, {"a": 1, "b": 2})
        assert sha256_file(path) == first
        assert json.loads(path.read_text(encoding="utf-8")) == {"a": 1, "b": 2}


def test_pmtiles_validation_requires_v3_magic():
    with tempfile.TemporaryDirectory() as directory:
        invalid = Path(directory) / "invalid.pmtiles"
        invalid.write_bytes(b"SQLite")
        assert not validate_pmtiles(invalid)["valid"]
        valid = Path(directory) / "valid.pmtiles"
        valid.write_bytes(b"PMTiles\x03payload")
        assert validate_pmtiles(valid)["valid"]
