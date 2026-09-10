"""Measured national OSM POI build for walking discovery.

The national product is deliberately independent of state roadway builds.  A
measurement pass creates a normalized, deduplicated stream and volume report;
tiling is a separate, resumable step that never publishes anything.
"""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.pipeline.osm_state import (
    BuildError,
    PIPELINE_VERSION,
    _empty_manifest,
    _osmium_source_date,
    _read_json,
    _run,
    atomic_json,
    download_file,
    hash_file,
    require_tools,
    sha256_file,
    validate_pmtiles,
)


NATIONAL_POI_CONTRACT_VERSION = "walking-v3"
NATIONAL_SOURCE_URL = "https://download.geofabrik.de/north-america/us-latest.osm.pbf"
# Early filtering is intentionally a superset. Every expression has explicit
# values; the Python classifier below is the authoritative second gate.
NATIONAL_POI_EXPRESSIONS = (
    "nwr/leisure=park,nature_reserve,garden,dog_park,playground,recreation_ground,pitch,sports_centre,fitness_station,picnic_table,slipway",
    "nwr/boundary=national_park,protected_area",
    "nwr/natural=wood,wetland,grassland,heath,water,beach,bay,spring,peak,cave_entrance",
    "wr/waterway=river,stream,canal",
    "nwr/tourism=viewpoint,museum,gallery,artwork,picnic_site,information",
    "nwr/information=trailhead,guidepost,map,route_marker",
    "r/route=foot,hiking",
    "nwr/amenity=toilets,drinking_water,bench,shelter,library,community_centre,townhall,courthouse,arts_centre,marketplace,cafe,food_court",
    "nwr/place=square",
    "nwr/building=civic,government,public",
    "nwr/public_transport=platform,station,stop_position",
    "n/highway=bus_stop,crossing,elevator",
    "nwr/railway=station,halt,tram_stop,subway_entrance,platform",
    "nwr/highway=pedestrian,footway,path,steps,corridor",
    "nwr/crossing=uncontrolled,traffic_signals,marked,zebra,unmarked,pelican,toucan",
    "n/barrier=bollard,gate,lift_gate,swing_gate,stile,kissing_gate,cycle_bar,turnstile",
    "nwr/historic=monument,memorial,archaeological_site,ruins,castle,fort,battlefield,wayside_cross,wayside_shrine",
    "nwr/shop=bakery,convenience",
)

USEFUL_TAGS = frozenset({
    "name", "alt_name", "ref", "operator", "website", "wikidata", "wikipedia",
    "amenity", "tourism", "leisure", "natural", "water", "waterway", "historic",
    "shop", "boundary", "protect_class", "place", "building", "sport", "route",
    "highway", "footway", "crossing", "crossing:signals", "barrier", "railway",
    "public_transport", "information", "access", "foot", "wheelchair", "surface",
    "smoothness", "lit", "covered", "indoor", "bridge", "tunnel", "shelter_type",
    "tactile_paving", "kerb",
    "drinking_water", "toilets", "fee", "opening_hours", "outdoor_seating",
    "internet_access", "trail_visibility", "sac_scale", "designation",
})

WALKER_UTILITY_TAGS = frozenset({
    "opening_hours", "wheelchair", "outdoor_seating", "toilets", "drinking_water", "internet_access",
})


@dataclass(frozen=True, slots=True)
class Classification:
    category: str
    subcategory: str


class IdentityError(BuildError):
    """One exported feature lacks a usable, stable OSM identity."""


def category_contract() -> dict[str, Any]:
    """Return the stable UI-facing category contract included in reports."""
    return {
        "version": NATIONAL_POI_CONTRACT_VERSION,
        "categories": [
            "nature", "trail", "waterfront", "rest", "recreation", "civic",
            "transit", "crossing", "walkway", "barrier", "historic", "scenic", "food",
        ],
        "commercialPolicy": "Only named cafes, food courts, marketplaces, bakeries, and convenience stores with a walker-utility tag are accepted.",
        "sidewalkPolicy": "Sidewalks are excluded; footways require a name, reference, designation, structure, cover, or wheelchair tag.",
        "networkFeaturePolicy": "Crossings, barriers, waterways, and broad natural landcover are retained only when they have distinct walking or discovery value.",
    }


def delivery_contract() -> dict[str, Any]:
    """Declare that clients range-read this artifact instead of installing it."""
    return {
        "mode": "http_range",
        "fullDownloadAllowed": False,
        "offlineInstallable": False,
        "cachePolicy": "bounded_visible_tile_ranges",
        "offlineFallback": "downloaded regional/state packs and previously cached national tile ranges",
        "requiresAcceptRangesBytes": True,
    }


def classify_walking_poi(tags: dict[str, Any]) -> Classification | None:
    """Apply ordered, explicit walking-use rules to one OSM tag mapping."""
    value = lambda key: str(tags.get(key, "")).casefold()

    barrier = value("barrier")
    if barrier in {"stile", "kissing_gate", "cycle_bar", "turnstile"} or (
        barrier in {"bollard", "gate", "lift_gate", "swing_gate"}
        and any(value(key) for key in ("access", "foot", "wheelchair"))
    ):
        return Classification("barrier", value("barrier"))
    crossing = value("crossing")
    # These two values dominate the national point volume while carrying no
    # positive signal that a crossing is marked or controlled. The basemap can
    # still render them; the discovery overlay keeps actionable crossings.
    if crossing in {"unmarked", "uncontrolled"}:
        return None
    if (value("highway") == "crossing" or crossing) and (
        crossing in {"traffic_signals", "marked", "zebra", "pelican", "toucan"}
        or any(value(key) for key in ("crossing:signals", "wheelchair", "tactile_paving", "kerb"))
    ):
        return Classification("crossing", crossing or "accessible_crossing")
    if value("amenity") in {"toilets", "drinking_water", "bench", "shelter"}:
        return Classification("rest", value("amenity"))
    if value("leisure") == "picnic_table":
        return Classification("rest", "picnic_table")

    if value("public_transport") in {"platform", "station", "stop_position"}:
        return Classification("transit", value("public_transport"))
    if value("highway") in {"bus_stop", "elevator"}:
        return Classification("transit", value("highway"))
    if value("railway") in {"station", "halt", "tram_stop", "subway_entrance", "platform"}:
        return Classification("transit", value("railway"))

    if value("route") in {"foot", "hiking"}:
        return Classification("trail", value("route"))
    if value("information") in {"trailhead", "guidepost", "map", "route_marker"}:
        return Classification("trail", value("information"))
    if value("highway") == "path" and any(value(key) for key in ("name", "ref", "designation", "sac_scale", "trail_visibility")):
        return Classification("trail", "path")
    if value("highway") == "steps":
        return Classification("walkway", value("highway"))
    significant_walkway_tags = ("name", "ref", "designation", "wheelchair", "bridge", "tunnel", "covered")
    if value("highway") in {"pedestrian", "corridor", "footway"} and value("footway") != "sidewalk" and any(
        value(key) for key in significant_walkway_tags
    ):
        return Classification("walkway", value("highway"))

    if value("natural") in {"beach", "bay", "spring"}:
        return Classification("waterfront", value("water") or value("natural"))
    if value("natural") == "water" and any(value(key) for key in ("name", "ref", "wikidata", "wikipedia")):
        return Classification("waterfront", value("water") or value("natural"))
    if value("waterway") in {"river", "stream", "canal"} and any(value(key) for key in ("wikidata", "wikipedia")):
        return Classification("waterfront", value("waterway"))
    if value("leisure") in {"park", "nature_reserve", "garden", "dog_park"}:
        return Classification("nature", value("leisure"))
    if value("boundary") in {"national_park", "protected_area"}:
        return Classification("nature", value("boundary"))
    if value("natural") in {"wood", "wetland", "grassland", "heath"} and any(
        value(key) for key in ("name", "operator", "wikidata", "wikipedia")
    ):
        return Classification("nature", value("natural"))

    if value("tourism") in {"viewpoint", "picnic_site"}:
        return Classification("scenic", value("tourism"))
    if value("natural") in {"peak", "cave_entrance"}:
        return Classification("scenic", value("natural"))
    if value("tourism") in {"museum", "gallery", "artwork"}:
        return Classification("historic", value("tourism"))
    if value("historic") in {"monument", "memorial", "archaeological_site", "ruins", "castle", "fort", "battlefield", "wayside_cross", "wayside_shrine"}:
        return Classification("historic", value("historic"))

    if value("leisure") in {"playground", "recreation_ground", "pitch", "sports_centre", "fitness_station", "slipway"}:
        return Classification("recreation", value("leisure"))
    if value("amenity") in {"library", "community_centre", "townhall", "courthouse", "arts_centre"}:
        return Classification("civic", value("amenity"))
    if value("place") == "square":
        return Classification("civic", "public_square")
    if value("building") in {"civic", "government", "public"}:
        return Classification("civic", value("building"))

    commercial = value("amenity") in {"marketplace", "cafe", "food_court"} or value("shop") in {"bakery", "convenience"}
    if commercial and value("name") and any(value(key) for key in WALKER_UTILITY_TAGS):
        return Classification("food", value("amenity") or value("shop"))
    return None


_OSM_IDENTITY = re.compile(r"^(node|way|relation|area|n|w|r|a)/?(-?\d+)$", re.IGNORECASE)
_OSM_TYPE_ALIASES = {"n": "node", "w": "way", "r": "relation", "a": "area"}


def _source_identity_from_area(area_id: int) -> tuple[str, str]:
    """Decode Osmium's collision-free area ID back to its source object."""
    absolute = abs(area_id)
    source_type = "way" if absolute % 2 == 0 else "relation"
    source_id = absolute // 2
    if area_id < 0:
        source_id = -source_id
    return source_type, str(source_id)


def _split_osm_identity(properties: dict[str, Any], feature_id: Any = None) -> tuple[str, str]:
    raw_type = str(properties.get("@type") or properties.get("type") or "").strip().casefold()
    # --add-unique-id writes GeoJSON's top-level feature id. Prefer it over
    # same-named OSM tags in the properties mapping.
    raw_id_value = feature_id if feature_id is not None else properties.get("@id") or properties.get("id")
    raw_id = str(raw_id_value or "").strip()

    match = _OSM_IDENTITY.fullmatch(raw_id)
    if match:
        encoded_type, raw_id = match.groups()
        encoded_type = _OSM_TYPE_ALIASES.get(encoded_type.casefold(), encoded_type.casefold())
        raw_type = encoded_type
        # The feature ID is authoritative when it carries Osmium's area marker.
        # Its numeric part is 2*way_id or 2*relation_id+1.
        if encoded_type == "area":
            return _source_identity_from_area(int(raw_id))
    else:
        raw_type = _OSM_TYPE_ALIASES.get(raw_type, raw_type)

    if raw_type == "area" and re.fullmatch(r"-?\d+", raw_id):
        return _source_identity_from_area(int(raw_id))
    if raw_type not in {"node", "way", "relation"} or not re.fullmatch(r"-?\d+", raw_id):
        raise IdentityError("OSM export omitted a stable type/id; use osmium export --add-unique-id=type_id.")
    return raw_type, raw_id


def normalize_national_feature(feature: dict[str, Any], *, release: str, source: dict[str, Any]) -> dict[str, Any] | None:
    properties = dict(feature.get("properties") or {})
    tags = dict(properties.get("tags") or {key: value for key, value in properties.items() if not key.startswith("@")})
    classification = classify_walking_poi(tags)
    geometry = feature.get("geometry")
    if classification is None or not geometry:
        return None
    osm_type, osm_id = _split_osm_identity(properties, feature.get("id"))
    selected = {key: str(tags[key]) for key in sorted(USEFUL_TAGS.intersection(tags)) if tags[key] not in (None, "")}
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "osm_type": osm_type,
            "osm_id": osm_id,
            "osm_version": properties.get("version") or properties.get("@version"),
            "osm_timestamp": properties.get("timestamp") or properties.get("@timestamp"),
            "name": tags.get("name"),
            "category": classification.category,
            "subcategory": classification.subcategory,
            "source": "OpenStreetMap",
            "attribution": "© OpenStreetMap contributors",
            "source_release": release,
            "source_timestamp": source.get("sourceDate"),
            "source_sha256": source.get("sha256"),
            "contract_version": NATIONAL_POI_CONTRACT_VERSION,
            # MVT has scalar properties, so useful original tags are retained as
            # canonical JSON rather than as an unsupported nested object.
            "osm_tags": json.dumps(selected, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
        },
    }


def national_plan(release: str, root: Path, *, source_url: str = NATIONAL_SOURCE_URL) -> dict[str, Any]:
    source = root / "sources" / "osm" / "us.osm.pbf"
    return {
        "release": release,
        "product": "national-poi",
        "source": {"url": source_url, "path": str(source.resolve()), "cached": source.exists()},
        "strategy": "single_national_snapshot_streamed_to_normalized_geojsonseq",
        "deduplication": "disk-backed unique (osm_type, osm_id)",
        "contract": category_contract(),
        "delivery": delivery_contract(),
        "expressions": list(NATIONAL_POI_EXPRESSIONS),
        "stages": ["measure-national-poi", "review category-report.json", "build-national-poi", "validate-national-poi"],
        "resourceEstimate": {
            "networkGiB": "about 11.3 for the 2026-09-07 snapshot",
            "peakWorkingDiskGiB": "35-60",
            "expectedFeatures": "2-6 million; measurement is authoritative",
            "expectedArtifactGiB": "0.4-1.2; 2 GiB hard ceiling",
        },
        "publishing": "disabled",
        "tools": require_tools("osmium", "tippecanoe", "pmtiles"),
    }


def _prepare_source(root: Path, source_url: str, source_sha256: str | None) -> tuple[Path, dict[str, Any]]:
    source_path = root / "sources" / "osm" / "us.osm.pbf"
    metadata_path = source_path.with_suffix(".source.json")
    metadata = _read_json(metadata_path, {})
    if not source_path.exists():
        metadata = download_file(source_url, source_path)
    actual_sha256 = sha256_file(source_path)
    if source_sha256 and source_sha256.casefold() != actual_sha256.casefold():
        raise BuildError(f"Source checksum mismatch: expected {source_sha256}, got {actual_sha256}.")
    resolved_url = str(metadata.get("url") or source_url)
    if resolved_url.startswith("https://download.geofabrik.de/"):
        import urllib.request
        checksum_url = resolved_url + ".md5"
        with urllib.request.urlopen(checksum_url, timeout=60) as response:
            expected_md5 = response.read().decode("ascii", "replace").strip().split()[0].casefold()
        actual_md5 = hash_file(source_path, "md5")
        if expected_md5 != actual_md5:
            raise BuildError(f"Geofabrik MD5 mismatch: expected {expected_md5}, got {actual_md5}.")
        metadata["providerChecksum"] = {"algorithm": "md5", "value": expected_md5, "verified": True, "url": checksum_url}
    osmium = str(require_tools("osmium")["osmium"]["path"])
    metadata.update({
        "url": resolved_url,
        "requestedUrl": source_url,
        "bytes": source_path.stat().st_size,
        "sha256": actual_sha256,
        "sourceDate": _osmium_source_date(osmium, source_path) or metadata.get("lastModified"),
    })
    atomic_json(metadata_path, metadata)
    return source_path, metadata


def _density_summary(cells: Counter[str]) -> dict[str, Any]:
    values = sorted(cells.values())
    percentile = lambda p: values[min(len(values) - 1, math.ceil(p * len(values)) - 1)] if values else 0
    return {
        "grid": "one_degree_lon_lat",
        "populatedCells": len(values),
        "p50FeaturesPerCell": percentile(0.50),
        "p95FeaturesPerCell": percentile(0.95),
        "maxFeaturesPerCell": values[-1] if values else 0,
        "topCells": [{"cell": cell, "features": count} for cell, count in cells.most_common(20)],
    }


def _geometry_anchor(geometry: dict[str, Any]) -> tuple[float, float] | None:
    west = south = math.inf
    east = north = -math.inf
    def visit(value: Any) -> None:
        nonlocal west, south, east, north
        if isinstance(value, list) and len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            x, y = float(value[0]), float(value[1])
            west, south, east, north = min(west, x), min(south, y), max(east, x), max(north, y)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(geometry.get("coordinates"))
    if west == math.inf:
        return None
    return ((west + east) / 2, (south + north) / 2)


def normalize_national_stream(
    source: Path,
    destination: Path,
    dedupe_db: Path,
    *,
    release: str,
    source_metadata: dict[str, Any],
    maximum: int,
) -> dict[str, Any]:
    """Normalize and measure a GeoJSON sequence with bounded RAM use."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    dedupe_db.unlink(missing_ok=True)
    accepted = rejected = identity_rejected = duplicates = candidate_count = json_bytes = 0
    category_counts: Counter[str] = Counter()
    subcategory_counts: Counter[str] = Counter()
    geometry_counts: Counter[str] = Counter()
    category_bytes: Counter[str] = Counter()
    cells: Counter[str] = Counter()
    connection = sqlite3.connect(dedupe_db)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE seen (osm_type TEXT NOT NULL, osm_id TEXT NOT NULL, PRIMARY KEY(osm_type, osm_id)) WITHOUT ROWID")
    try:
        with source.open(encoding="utf-8") as incoming, destination.open("w", encoding="utf-8", newline="\n") as outgoing:
            for line in incoming:
                line = line.strip().lstrip("\x1e")
                if not line:
                    continue
                candidate_count += 1
                try:
                    normalized = normalize_national_feature(json.loads(line), release=release, source=source_metadata)
                except IdentityError:
                    rejected += 1
                    identity_rejected += 1
                    continue
                if normalized is None:
                    rejected += 1
                    continue
                props = normalized["properties"]
                inserted = connection.execute("INSERT OR IGNORE INTO seen VALUES (?, ?)", (props["osm_type"], props["osm_id"])).rowcount
                if not inserted:
                    duplicates += 1
                    continue
                encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
                outgoing.write(encoded)
                accepted += 1
                if accepted > maximum:
                    raise BuildError(f"National POI safety ceiling exceeded ({maximum} accepted features); review the measured contract.")
                category_counts[props["category"]] += 1
                subcategory_counts[f'{props["category"]}/{props["subcategory"]}'] += 1
                geometry_counts[normalized["geometry"].get("type", "unknown")] += 1
                byte_count = len(encoded.encode("utf-8"))
                json_bytes += byte_count
                category_bytes[props["category"]] += byte_count
                anchor = _geometry_anchor(normalized["geometry"])
                if anchor:
                    cells[f"{math.floor(anchor[0])},{math.floor(anchor[1])}"] += 1
                if accepted % 100_000 == 0:
                    connection.commit()
        connection.commit()
    finally:
        connection.close()
    if accepted == 0:
        raise BuildError("The national walking POI contract produced zero usable features.")
    return {
        "candidateCount": candidate_count,
        "featureCount": accepted,
        "rejectedCount": rejected,
        "identityRejectedCount": identity_rejected,
        "duplicateCount": duplicates,
        "categoryCounts": dict(sorted(category_counts.items())),
        "subcategoryCounts": dict(sorted(subcategory_counts.items())),
        "geometryCounts": dict(sorted(geometry_counts.items())),
        "normalizedBytes": json_bytes,
        "categoryNormalizedBytes": dict(sorted(category_bytes.items())),
        "density": _density_summary(cells),
    }


def measure_national_poi(
    release: str,
    root: Path,
    *,
    source_url: str = NATIONAL_SOURCE_URL,
    source_sha256: str | None = None,
    max_candidates: int = 8_000_000,
    max_filtered_bytes: int = 8 * 1024**3,
) -> dict[str, Any]:
    work = root / "work" / release / "national" / "poi"
    work.mkdir(parents=True, exist_ok=True)
    error_path = work / "measurement-error.json"
    error_path.unlink(missing_ok=True)
    expressions = work / "poi.expressions"
    filtered = work / "poi.osm.pbf"
    raw = work / "poi.geojsonseq"
    normalized = work / "poi.normalized.geojsonseq"
    dedupe = work / "poi-dedupe.sqlite"
    report_path = work / "category-report.json"
    # A rerun must not leave a stale successful report visible while its
    # normalized stream is being replaced.
    report_path.unlink(missing_ok=True)
    started = datetime.now(timezone.utc)
    stage = "preflight"
    command_context: dict[str, Any] = {"operation": "require_tools", "tools": ["osmium"]}
    try:
        tools = require_tools("osmium")
        stage = "prepare-source"
        command_context = {"operation": "prepare_source", "sourceUrl": source_url, "sourceSha256": source_sha256}
        source_path, source_metadata = _prepare_source(root, source_url, source_sha256)
        expressions.write_text("\n".join(NATIONAL_POI_EXPRESSIONS) + "\n", encoding="utf-8", newline="\n")

        stage = "filter"
        command = [str(tools["osmium"]["path"]), "tags-filter", "--overwrite", "--remove-tags", "--expressions", str(expressions), "-o", str(filtered), str(source_path)]
        command_context = {"argv": command, "cwd": str(Path.cwd().resolve())}
        _run(command)
        if filtered.stat().st_size > max_filtered_bytes:
            raise BuildError(f"National filtered PBF safety ceiling exceeded ({filtered.stat().st_size} > {max_filtered_bytes} bytes).")

        stage = "export"
        command = [
            str(tools["osmium"]["path"]), "export", "-f", "geojsonseq", "--add-unique-id", "type_id",
            "--attributes", "version,timestamp", "--overwrite", "-o", str(raw), str(filtered),
        ]
        command_context = {"argv": command, "cwd": str(Path.cwd().resolve())}
        _run(command)

        stage = "normalize"
        command_context = {
            "operation": "normalize_national_stream", "source": str(raw.resolve()),
            "destination": str(normalized.resolve()), "maximum": max_candidates,
        }
        metrics = normalize_national_stream(raw, normalized, dedupe, release=release, source_metadata=source_metadata, maximum=max_candidates)
    except Exception as exc:
        atomic_json(error_path, {
            "release": release,
            "product": "national-poi",
            "status": "failed",
            "failedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "stage": stage,
            "exception": {"type": type(exc).__name__, "message": str(exc)},
            "commandContext": command_context,
        })
        raise
    try:
        stage = "write-report"
        command_context = {"operation": "atomic_json", "destination": str(report_path.resolve())}
        report = {
            "release": release,
            "product": "national-poi",
            "status": "measured",
            "measuredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "durationSeconds": round((datetime.now(timezone.utc) - started).total_seconds(), 3),
            "contract": category_contract(),
            "sourceOsm": source_metadata,
            "expressionSha256": sha256_file(expressions),
            "filteredPbfBytes": filtered.stat().st_size,
            **metrics,
            "normalizedPath": str(normalized.resolve()),
            "normalizedSha256": sha256_file(normalized),
            "reviewRequiredBeforeTiling": True,
        }
        atomic_json(report_path, report)
        report_checksum = sha256_file(report_path)
        stage = "cleanup"
        command_context = {"operation": "remove_measurement_intermediates"}
        for temporary in (filtered, raw, dedupe, dedupe.with_name(dedupe.name + "-wal"), dedupe.with_name(dedupe.name + "-shm")):
            temporary.unlink(missing_ok=True)
        return {**report, "reportPath": str(report_path.resolve()), "reportSha256": report_checksum}
    except Exception as exc:
        atomic_json(error_path, {
            "release": release,
            "product": "national-poi",
            "status": "failed",
            "failedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "stage": stage,
            "exception": {"type": type(exc).__name__, "message": str(exc)},
            "commandContext": command_context,
        })
        raise


def _reviewed_measurement(
    root: Path, release: str, accepted_report_sha256: str | None,
) -> tuple[dict[str, Any], Path, str]:
    work = root / "work" / release / "national" / "poi"
    report_path = work / "category-report.json"
    normalized = work / "poi.normalized.geojsonseq"
    report = _read_json(report_path, None)
    if not isinstance(report, dict) or not normalized.exists() or report.get("normalizedSha256") != sha256_file(normalized):
        raise BuildError("No valid measured national POI stream exists; run measure-national-poi and review category-report.json first.")
    measured_report_sha256 = sha256_file(report_path)
    if not accepted_report_sha256:
        raise BuildError(f"Review the measurement report, then pass --accept-report-sha256 {measured_report_sha256}.")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", accepted_report_sha256) or accepted_report_sha256.casefold() != measured_report_sha256.casefold():
        raise BuildError(f"Accepted measurement checksum differs: expected {measured_report_sha256}, got {accepted_report_sha256}.")
    return report, normalized, measured_report_sha256


def build_national_poi(
    release: str,
    root: Path,
    *,
    source_url: str = NATIONAL_SOURCE_URL,
    source_sha256: str | None = None,
    max_candidates: int = 8_000_000,
    max_artifact_bytes: int = 2 * 1024**3,
    accepted_report_sha256: str | None = None,
) -> dict[str, Any]:
    manifest_path = root / "releases" / release / "manifest.json"
    report, normalized, measured_report_sha256 = _reviewed_measurement(root, release, accepted_report_sha256)
    tools = require_tools("tippecanoe", "pmtiles")
    existing = _read_json(manifest_path, {}).get("national", {}).get("poi", {})
    if existing.get("localAvailable"):
        existing_validation = validate_national_poi(root, release)
        if existing_validation.get("valid"):
            return {"status": "already_valid", "artifact": existing_validation["artifact"]["path"], "manifest": str(manifest_path.resolve()), "metadata": existing}
    work = root / "work" / release / "national" / "poi"
    if source_sha256 and source_sha256.casefold() != str(report.get("sourceOsm", {}).get("sha256", "")).casefold():
        raise BuildError("Pinned source SHA-256 differs from the reviewed measurement source.")
    if int(report.get("featureCount", 0)) > max_candidates:
        raise BuildError(f"Reviewed measurement exceeds the active feature ceiling ({max_candidates}).")
    if report.get("contract", {}).get("version") != NATIONAL_POI_CONTRACT_VERSION:
        raise BuildError("Measurement contract version differs from the active category contract; re-run measurement.")
    release_dir = root / "releases" / release
    final_dir = release_dir / "national"
    final_dir.mkdir(parents=True, exist_ok=True)
    mbtiles = work / "poi.mbtiles"
    staged = work / "poi.pmtiles"
    artifact = final_dir / "poi.pmtiles"
    started = datetime.now(timezone.utc)
    _run([
        str(tools["tippecanoe"]["path"]), "--force", "--layer", "poi", "--minimum-zoom", "4", "--maximum-zoom", "14",
        "--drop-densest-as-needed", "--extend-zooms-if-still-dropping", "--name", f"Gremlin Lab national walking POIs {release}",
        "--attribution", "© OpenStreetMap contributors", "-o", str(mbtiles), str(normalized),
    ])
    _run([str(tools["pmtiles"]["path"]), "convert", str(mbtiles), str(staged)])
    validation = validate_pmtiles(staged)
    if not validation["valid"]:
        raise BuildError(f"PMTiles validation failed: {validation['error']}")
    if staged.stat().st_size > max_artifact_bytes:
        raise BuildError(f"National POI PMTiles safety ceiling exceeded ({staged.stat().st_size} > {max_artifact_bytes} bytes).")
    os.replace(staged, artifact)
    item = {
        "available": True,
        "localAvailable": True,
        "cloudAvailable": False,
        "url": None,
        "path": "national/poi.pmtiles",
        "bytes": artifact.stat().st_size,
        "sha256": sha256_file(artifact),
        "pmtilesVersion": 3,
        "featureCount": report["featureCount"],
        "categoryCounts": report["categoryCounts"],
        "geometryCounts": report["geometryCounts"],
        "duplicateCount": report["duplicateCount"],
        "contractVersion": NATIONAL_POI_CONTRACT_VERSION,
        "delivery": delivery_contract(),
        "reportPath": "national/poi-category-report.json",
        "reportSha256": None,
        "measurementReportSha256": measured_report_sha256,
        "sourceOsm": report["sourceOsm"],
        "builtAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "buildDurationSeconds": round((datetime.now(timezone.utc) - started).total_seconds(), 3),
        "pipelineVersion": PIPELINE_VERSION,
        "tools": {name: value["version"] for name, value in tools.items()},
    }
    published_report = final_dir / "poi-category-report.json"
    public_report = {key: value for key, value in report.items() if key not in {"normalizedPath", "reportPath"}}
    public_report["reviewRequiredBeforeTiling"] = False
    atomic_json(published_report, public_report)
    item["reportSha256"] = sha256_file(published_report)
    manifest = _read_json(manifest_path, _empty_manifest(release))
    manifest.setdefault("national", {})["poi"] = item
    atomic_json(manifest_path, manifest)
    return {"status": "built", "artifact": str(artifact.resolve()), "manifest": str(manifest_path.resolve()), "metadata": item}


def validate_national_poi(root: Path, release: str) -> dict[str, Any]:
    manifest_path = root / "releases" / release / "manifest.json"
    manifest = _read_json(manifest_path, {})
    item = manifest.get("national", {}).get("poi", {})
    errors: list[str] = []
    if not item.get("localAvailable"):
        errors.append("national POI is not marked locally available")
    for field in ("bytes", "sha256", "featureCount", "categoryCounts", "geometryCounts", "sourceOsm", "reportSha256"):
        if item.get(field) is None:
            errors.append(f"national POI manifest is missing {field}")
    if item.get("pmtilesVersion") != 3:
        errors.append("manifest does not declare PMTiles v3")
    delivery = item.get("delivery") or {}
    if (
        delivery.get("mode") != "http_range"
        or delivery.get("fullDownloadAllowed") is not False
        or delivery.get("offlineInstallable") is not False
        or not delivery.get("requiresAcceptRangesBytes")
    ):
        errors.append("national POI delivery contract must require range reads and prohibit full downloads")
    source = item.get("sourceOsm") or {}
    for field in ("url", "bytes", "sha256", "sourceDate"):
        if not source.get(field):
            errors.append(f"national POI source metadata is missing {field}")
    if str(source.get("url", "")).startswith("https://download.geofabrik.de/"):
        provider_checksum = source.get("providerChecksum") or {}
        if not provider_checksum.get("verified") or not provider_checksum.get("value"):
            errors.append("national POI Geofabrik checksum is not verified")
    artifact = manifest_path.parent / item.get("path", "national/poi.pmtiles")
    validation = validate_pmtiles(artifact)
    if not validation.get("valid"):
        errors.append(validation.get("error", "invalid PMTiles"))
    if validation.get("sha256") != item.get("sha256"):
        errors.append("artifact checksum mismatch")
    if validation.get("bytes") != item.get("bytes"):
        errors.append("artifact byte size mismatch")
    report_path = manifest_path.parent / item.get("reportPath", "national/poi-category-report.json")
    report = _read_json(report_path, {})
    if not report or sha256_file(report_path) != item.get("reportSha256"):
        errors.append("category report missing or checksum mismatch")
    if report.get("featureCount") != item.get("featureCount"):
        errors.append("feature count differs from category report")
    if report.get("categoryCounts") != item.get("categoryCounts") or sum((item.get("categoryCounts") or {}).values()) != item.get("featureCount"):
        errors.append("category counts do not reconcile to feature count")
    if item.get("contractVersion") != NATIONAL_POI_CONTRACT_VERSION:
        errors.append("category contract version mismatch")
    if report.get("contract", {}).get("version") != NATIONAL_POI_CONTRACT_VERSION:
        errors.append("category report contract version mismatch")
    return {
        "valid": not errors,
        "errors": errors,
        "artifact": validation,
        "featureCount": item.get("featureCount"),
        "categoryCounts": item.get("categoryCounts"),
        "path": str(manifest_path.resolve()),
    }
