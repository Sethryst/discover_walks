import json

import pytest

import app.pipeline.osm_national_poi as national
from app.pipeline.osm_national_poi import (
    NATIONAL_POI_EXPRESSIONS,
    _reviewed_measurement,
    category_contract,
    classify_walking_poi,
    delivery_contract,
    normalize_national_feature,
    normalize_national_stream,
)
from app.pipeline.osm_state import BuildError, atomic_json, sha256_file
from app.pipeline.osm_state_cli import parser


def feature(osm_id, tags, geometry=None):
    return {
        "type": "Feature",
        "geometry": geometry or {"type": "Point", "coordinates": [-77.1, 38.9]},
        "properties": {"@id": f"node/{osm_id}", "@version": 3, "@timestamp": "2026-09-07T00:00:00Z", **tags},
    }


def test_contract_is_explicit_and_excludes_mass_market_categories():
    assert category_contract()["version"] == "walking-v3"
    assert all("=" in expression for expression in NATIONAL_POI_EXPRESSIONS)
    expressions = "\n".join(NATIONAL_POI_EXPRESSIONS)
    assert "restaurant" not in expressions
    assert "supermarket" not in expressions
    assert delivery_contract()["fullDownloadAllowed"] is False
    assert delivery_contract()["requiresAcceptRangesBytes"] is True


def test_ordered_walking_categories_and_sidewalk_volume_gate():
    assert classify_walking_poi({"amenity": "drinking_water"}).category == "rest"
    assert classify_walking_poi({"highway": "crossing", "crossing": "unmarked"}) is None
    assert classify_walking_poi({"highway": "crossing", "crossing": "uncontrolled", "kerb": "lowered"}) is None
    assert classify_walking_poi({"highway": "crossing", "crossing": "marked"}).category == "crossing"
    assert classify_walking_poi({"highway": "footway", "footway": "sidewalk"}) is None
    assert classify_walking_poi({"highway": "footway"}) is None
    assert classify_walking_poi({"highway": "footway", "surface": "paved"}) is None
    assert classify_walking_poi({"highway": "footway", "name": "River Walk"}).category == "walkway"
    assert classify_walking_poi({"highway": "path"}) is None
    assert classify_walking_poi({"highway": "path", "trail_visibility": "good"}).category == "trail"
    assert classify_walking_poi({"waterway": "stream"}) is None
    assert classify_walking_poi({"waterway": "stream", "name": "Rock Creek"}) is None
    assert classify_walking_poi({"waterway": "stream", "name": "Rock Creek", "wikidata": "Q1"}).category == "waterfront"
    assert classify_walking_poi({"natural": "wood"}) is None
    assert classify_walking_poi({"natural": "wood", "name": "Town Forest"}).category == "nature"
    assert classify_walking_poi({"barrier": "gate"}) is None
    assert classify_walking_poi({"barrier": "stile"}).category == "barrier"


def test_commercial_pois_require_name_and_walker_utility():
    assert classify_walking_poi({"amenity": "restaurant", "name": "No"}) is None
    assert classify_walking_poi({"amenity": "cafe", "name": "Generic"}) is None
    accepted = classify_walking_poi({"amenity": "cafe", "name": "Useful", "toilets": "yes"})
    assert (accepted.category, accepted.subcategory) == ("food", "cafe")


def test_normalization_preserves_identity_provenance_and_bounded_tags():
    normalized = normalize_national_feature(
        feature(42, {"amenity": "library", "name": "Library", "phone": "not-published"}),
        release="osm-us-test",
        source={"sha256": "abc", "sourceDate": "2026-09-07T00:00:00Z"},
    )
    props = normalized["properties"]
    assert (props["osm_type"], props["osm_id"], props["osm_version"]) == ("node", "42", 3)
    assert props["source_release"] == "osm-us-test"
    assert json.loads(props["osm_tags"])["amenity"] == "library"
    assert "phone" not in props["osm_tags"]
    top_level_id = feature(99, {"amenity": "library"})
    top_level_id["id"] = "w99"
    top_level_id["properties"].pop("@id")
    normalized_way = normalize_national_feature(top_level_id, release="osm-us-test", source={"sha256": "abc"})
    assert (normalized_way["properties"]["osm_type"], normalized_way["properties"]["osm_id"]) == ("way", "99")


@pytest.mark.parametrize(("unique_id", "osm_type", "osm_id"), [
    ("n123", "node", "123"),
    ("node/123", "node", "123"),
    ("w123", "way", "123"),
    ("way/123", "way", "123"),
    ("r123", "relation", "123"),
    ("relation/123", "relation", "123"),
    ("a246", "way", "123"),
    ("area/247", "relation", "123"),
])
def test_osmium_unique_identity_variants_map_to_source_objects(unique_id, osm_type, osm_id):
    row = feature(999, {"amenity": "library"})
    row["id"] = unique_id
    row["properties"].pop("@id")
    # A flat OSM tag named type must not override the top-level unique ID.
    row["properties"]["type"] = "multipolygon"
    normalized = normalize_national_feature(row, release="osm-us-test", source={"sha256": "abc"})
    assert (normalized["properties"]["osm_type"], normalized["properties"]["osm_id"]) == (osm_type, osm_id)


def test_stream_deduplicates_osm_identity_and_reconciles_counts(tmp_path):
    source = tmp_path / "input.geojsonseq"
    rows = [
        feature(1, {"amenity": "library", "name": "A"}),
        feature(1, {"amenity": "library", "name": "A duplicate"}),
        feature(2, {"amenity": "restaurant", "name": "Rejected"}),
        {**feature(4, {"amenity": "library", "name": "Bad identity"}), "id": "broken"},
        feature(3, {"barrier": "stile"}, {"type": "Point", "coordinates": [-76.2, 39.1]}),
    ]
    rows[3]["properties"].pop("@id")
    source.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
    destination = tmp_path / "normalized.geojsonseq"
    report = normalize_national_stream(
        source, destination, tmp_path / "dedupe.sqlite", release="osm-us-test",
        source_metadata={"sha256": "abc", "sourceDate": "2026-09-07T00:00:00Z"}, maximum=10,
    )
    assert report["candidateCount"] == 5
    assert report["featureCount"] == 2
    assert report["duplicateCount"] == 1
    assert report["rejectedCount"] == 2
    assert report["identityRejectedCount"] == 1
    assert sum(report["categoryCounts"].values()) == report["featureCount"]


def test_measurement_writes_durable_stage_error_with_command_context(tmp_path, monkeypatch):
    source = tmp_path / "us.osm.pbf"
    source.write_bytes(b"pbf")
    monkeypatch.setattr(national, "require_tools", lambda *_: {"osmium": {"path": "osmium"}})
    monkeypatch.setattr(national, "_prepare_source", lambda *_args, **_kwargs: (source, {"sha256": "abc"}))
    monkeypatch.setattr(national, "_run", lambda command: (_ for _ in ()).throw(BuildError("filter failed")))

    with pytest.raises(BuildError, match="filter failed"):
        national.measure_national_poi("osm-us-test", tmp_path)

    error = json.loads((tmp_path / "work/osm-us-test/national/poi/measurement-error.json").read_text(encoding="utf-8"))
    assert error["stage"] == "filter"
    assert error["exception"] == {"type": "BuildError", "message": "filter failed"}
    assert error["commandContext"]["argv"][:2] == ["osmium", "tags-filter"]


def test_measurement_review_gate_requires_exact_report_sha256(tmp_path):
    work = tmp_path / "work/osm-us-test/national/poi"
    work.mkdir(parents=True)
    normalized = work / "poi.normalized.geojsonseq"
    normalized.write_text("{}\n", encoding="utf-8")
    report_path = work / "category-report.json"
    atomic_json(report_path, {"normalizedSha256": sha256_file(normalized)})
    exact = sha256_file(report_path)

    with pytest.raises(BuildError, match="Review the measurement report"):
        _reviewed_measurement(tmp_path, "osm-us-test", None)
    with pytest.raises(BuildError, match="checksum differs"):
        _reviewed_measurement(tmp_path, "osm-us-test", "0" * 64)
    assert _reviewed_measurement(tmp_path, "osm-us-test", exact)[2] == exact


def test_cli_exposes_separate_measure_build_and_validate_stages():
    cli = parser()
    assert cli.parse_args(["measure-national-poi"]).command == "measure-national-poi"
    assert cli.parse_args(["build-national-poi", "--accept-report-sha256", "abc"]).max_artifact_bytes == 2 * 1024**3
    assert cli.parse_args(["validate-national-poi"]).command == "validate-national-poi"
    with pytest.raises(SystemExit):
        cli.parse_args(["build-national-poi"])
