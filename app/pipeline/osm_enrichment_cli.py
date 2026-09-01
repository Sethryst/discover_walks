"""Region-wide OSM build and coverage reporting commands."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.pipeline.adapters.osm import OsmOverpassProvider
from app.pipeline.cache import cache_response, load_cached_response
from app.pipeline.normalization import normalize_overpass
from app.pipeline.osm_config import OSM_ATTRIBUTION, OSM_LICENSE, OSM_LICENSE_URL, normalize_osm_config, osm_source_dict
from app.pipeline.region_builder import build_region
from app.pipeline.source_config import SourceConfig


def region_files(regions_dir: Path) -> list[Path]:
    """Return only canonical region definitions, excluding adjacent registries."""
    output: list[Path] = []
    for path in sorted(regions_dir.glob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if {"id", "name", "bbox"}.issubset(value):
            output.append(path)
    return output


def build_all(
    regions_dir: Path,
    output_root: Path,
    cache_root: Path,
    producer_version: str,
    generated_at: str,
    use_cache: bool,
    runtime_root: Path | None = None,
    activate_after_build: bool = False,
    only: set[str] | None = None,
) -> dict[str, Any]:
    """Build OSM sources and atomically activate only verified runtime packages."""
    result: dict[str, Any] = {"schemaVersion": 1, "generatedAt": generated_at, "completed": {}, "unavailable": {}, "failed": {}}
    for path in region_files(regions_dir):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if only and raw["id"] not in only:
            continue
        try:
            osm = normalize_osm_config(raw)
            if runtime_root is not None:
                built = _build_runtime_package(raw, osm, runtime_root, output_root, cache_root, generated_at, use_cache)
                if activate_after_build:
                    _set_region_state(path, raw, enabled=True)
                result["completed"][raw["id"]] = built
                print(f"{raw['id']}: built {built['osmPois']} OSM / {built['mergedPois']} merged")
                continue
            if not osm.enabled:
                result["unavailable"][raw["id"]] = osm.unavailable_reason
                continue
            built = build_region(path, output_root, cache_root, producer_version, generated_at, use_cache=use_cache, only_sources={osm.source_id})
            result["completed"][raw["id"]] = {"osmPois": built["osmPois"], "packagePath": built["destination"], "warnings": built["warnings"]}
        except Exception as exc:
            result["failed"][raw.get("id", path.stem)] = str(exc)
            print(f"{raw.get('id', path.stem)}: unavailable ({exc})")
            if activate_after_build:
                _set_region_state(path, raw, enabled=False, reason=f"OSM build failed at {generated_at}: {exc}")
    return result


def _build_runtime_package(region: dict[str, Any], osm: Any, runtime_root: Path, output_root: Path, cache_root: Path, generated_at: str, use_cache: bool) -> dict[str, Any]:
    """Acquire/replay one bounded source and publish the complete runtime contract."""
    active_osm = replace(osm, status="enabled", enabled=True, unavailable_reason=None, package_path=f"motherbird/regions/{region['id']}/osm/pois.json")
    source = SourceConfig.from_dict(osm_source_dict(active_osm))
    provider = OsmOverpassProvider()
    if use_cache:
        try:
            cache_path = _latest_cache(cache_root, region["id"], source.id)
            raw = load_cached_response(cache_path)
        except FileNotFoundError:
            _, raw = provider.acquire(source, {**region, "bbox": list(active_osm.bbox)})
            cache_path = cache_response(cache_root, region["id"], source.id, raw, generated_at)
    else:
        _, raw = provider.acquire(source, {**region, "bbox": list(active_osm.bbox)})
        cache_path = cache_response(cache_root, region["id"], source.id, raw, generated_at)
    source_vintage = raw.get("osm3s", {}).get("timestamp_osm_base") or generated_at
    if raw.get("remark"):
        raise RuntimeError(f"Cached Overpass response is incomplete: {raw['remark']}")
    pois, warnings = normalize_overpass(raw.get("elements", []), source.id, source_vintage, list(active_osm.bbox))
    boundary = _json(output_root / region["id"] / "geography" / "boundary.geojson")
    if boundary:
        before = len(pois)
        pois = [poi for poi in pois if _inside_geojson(poi["lng"], poi["lat"], boundary)]
        warnings.append({"code": "boundary_clip_applied", "source": source.id, "detail": f"Excluded {before - len(pois)} named OSM records outside the installed regional boundary."})
    if len(raw.get("elements", [])) >= active_osm.max_records:
        warnings.append({"code": "max_records_reached", "source": source.id, "detail": f"The bounded Overpass response reached maxRecords={active_osm.max_records}."})
    pois = sorted(pois, key=lambda poi: poi["id"])[:active_osm.max_records]
    primary = _load_primary_pois(runtime_root, region["id"])
    merged, merge_warnings = _merge_public_pois(primary, pois, source.id)
    warnings.extend(merge_warnings)
    output = runtime_root / "regions" / region["id"] / "osm"
    output.mkdir(parents=True, exist_ok=True)
    envelope = {"schemaVersion": 1, "regionId": region["id"], "generatedAt": generated_at, "sourceVintage": source_vintage, "sourceConfigurationId": source.id, "attribution": OSM_ATTRIBUTION, "license": OSM_LICENSE, "licenseUrl": OSM_LICENSE_URL, "pois": pois}
    merged_envelope = {"schemaVersion": 1, "regionId": region["id"], "generatedAt": generated_at, "sourceVintage": source_vintage, "authoritativeRecordCount": len(primary), "osmRecordCount": len(pois), "pois": merged}
    validation = {"schemaVersion": 1, "regionId": region["id"], "generatedAt": generated_at, "accepted": len(pois), "rejected": sum(warning["code"] in {"unusable_source_record", "out_of_bounds", "duplicate_osm_record"} for warning in warnings), "warnings": warnings}
    spatial = {"schemaVersion": 1, "regionId": region["id"], "generatedAt": generated_at, "sourceConfigurationId": source.id, "records": [{key: poi[key] for key in ("id", "lat", "lng", "category")} for poi in pois]}
    attribution = {"attribution": OSM_ATTRIBUTION, "license": OSM_LICENSE, "licenseUrl": OSM_LICENSE_URL, "sourceVintage": source_vintage, "buildTimestamp": generated_at}
    artifacts = {"pois.json": envelope, "merged-pois.json": merged_envelope, "validation.json": validation, "spatial-index-delta.json": spatial, "attribution.json": attribution}
    artifact_bytes = {name: _bytes(value) for name, value in artifacts.items()}
    manifest = {
        "schemaVersion": 1, "regionId": region["id"], "generatedAt": generated_at, "sourceVintage": source_vintage, "sourceConfigurationId": source.id,
        "source": {"name": "OpenStreetMap", "url": active_osm.endpoint, "attribution": OSM_ATTRIBUTION, "license": OSM_LICENSE, "licenseUrl": OSM_LICENSE_URL, "rawResponseSha256": f"sha256:{hashlib.sha256(cache_path.read_bytes()).hexdigest()}"},
        "recordCountsByCategory": dict(sorted(Counter(poi["category"] for poi in pois).items())), "artifacts": list(artifact_bytes),
        "checksums": {name: f"sha256:{hashlib.sha256(content).hexdigest()}" for name, content in artifact_bytes.items()},
    }
    for name, content in artifact_bytes.items():
        (output / name).write_bytes(content)
    (output / "manifest.json").write_bytes(_bytes(manifest))
    if _checksum_status(output, manifest) is not True:
        raise RuntimeError("Published OSM runtime checksum verification failed.")
    return {"osmPois": len(pois), "mergedPois": len(merged), "packagePath": str(output).replace("\\", "/"), "warnings": warnings, "sourceVintage": source_vintage}


def _inside_geojson(lng: float, lat: float, payload: dict[str, Any]) -> bool:
    """Return whether a point lies in a Polygon/MultiPolygon FeatureCollection."""
    geometries = [feature.get("geometry", {}) for feature in payload.get("features", [])] if payload.get("type") == "FeatureCollection" else [payload.get("geometry", payload)]
    for geometry in geometries:
        coordinates = geometry.get("coordinates", [])
        polygons = [coordinates] if geometry.get("type") == "Polygon" else coordinates if geometry.get("type") == "MultiPolygon" else []
        for polygon in polygons:
            if polygon and _inside_ring(lng, lat, polygon[0]) and not any(_inside_ring(lng, lat, hole) for hole in polygon[1:]):
                return True
    return False


def _inside_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    previous = ring[-1] if ring else [0.0, 0.0]
    for current in ring:
        x1, y1 = previous[:2]
        x2, y2 = current[:2]
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def _latest_cache(cache_root: Path, region_id: str, source_id: str) -> Path:
    files = sorted((cache_root / region_id / source_id).glob("*.json"))
    if not files:
        raise FileNotFoundError(f"No raw cache available for {source_id}")
    return files[-1]


PRIMARY_ALIASES = {"boise-meridian-idaho": "boise-meridian-idaho", "keystone-colorado": "keystone-colorado", "prince-georges-county-md": "pgcounty", "sedona-arizona": "sedona-arizona", "washington-dc": "dc", "nyc": "newyork"}


def _load_primary_pois(runtime_root: Path, region_id: str) -> list[dict[str, Any]]:
    candidates = [runtime_root / "regions" / region_id / "pois.json", runtime_root / "data" / f"{PRIMARY_ALIASES.get(region_id, region_id)}-poi.json"]
    for path in candidates:
        payload = _json(path)
        if payload is None:
            continue
        pois = payload if isinstance(payload, list) else payload.get("pois", payload.get("pointsOfInterest", []))
        if isinstance(pois, list):
            return sorted((poi for poi in pois if isinstance(poi, dict) and poi.get("id")), key=lambda poi: str(poi["id"]))
    return []


def _merge_public_pois(primary: list[dict[str, Any]], osm_pois: list[dict[str, Any]], source_id: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    retained = [dict(poi) for poi in primary]
    warnings: list[dict[str, str]] = []
    for osm in osm_pois:
        match = next((poi for poi in retained if _same_public_place(poi, osm)), None)
        if match is None:
            retained.append(osm)
            continue
        existing = match.get("source", [])
        existing = existing if isinstance(existing, list) else [existing]
        incoming = osm.get("source", [])
        match["source"] = [*existing, *[value for value in incoming if value not in existing]]
        warnings.append({"code": "duplicate_reconciled", "source": source_id, "detail": f"{osm['id']} matched authoritative {match['id']}; authoritative fields were retained and OSM provenance appended."})
    return sorted(retained, key=lambda poi: str(poi.get("id", ""))), warnings


def _same_public_place(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if str(left.get("name", "")).casefold().strip() != str(right.get("name", "")).casefold().strip():
        return False
    if left.get("category") and right.get("category") and left["category"] != right["category"]:
        return False
    try:
        lat1, lng1, lat2, lng2 = map(float, (left["lat"], left["lng"], right["lat"], right["lng"]))
    except (KeyError, TypeError, ValueError):
        return False
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    value = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value)) <= 20


def _set_region_state(path: Path, raw: dict[str, Any], enabled: bool, reason: str | None = None) -> None:
    osm = normalize_osm_config(raw)
    raw["osm"] = {**osm.as_public_dict(), "status": "enabled" if enabled else "unavailable", "enabled": enabled}
    raw["osm"].pop("unavailableReason", None)
    raw["osm"].pop("packagePath", None)
    if enabled:
        raw["osm"]["packagePath"] = f"motherbird/regions/{raw['id']}/osm/pois.json"
    else:
        raw["osm"]["unavailableReason"] = reason or "No validated regional OSM package is available."
    path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def coverage_report(regions_dir: Path, output_root: Path, runtime_root: Path | None = None) -> dict[str, Any]:
    """Describe config, artifacts, record counts, validation, and spatial readiness."""
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    regions: list[dict[str, Any]] = []
    for path in region_files(regions_dir):
        raw = json.loads(path.read_text(encoding="utf-8"))
        warnings: list[str] = []
        try:
            osm = normalize_osm_config(raw)
        except ValueError as exc:
            warnings.append(str(exc))
            osm = None
        package = output_root / raw["id"]
        runtime_osm = runtime_root / "regions" / raw["id"] / "osm" if runtime_root else None
        osm_artifact = package / "supplemental" / "osm-pois.json"
        manifest_path = package / "producer-manifest.json"
        checksum_root = package
        validation_path = package / "supplemental" / "validation-report.json"
        if not osm_artifact.exists() and runtime_osm and runtime_osm.exists():
            osm_artifact = runtime_osm / "pois.json"
            manifest_path = runtime_osm / "manifest.json"
            checksum_root = runtime_osm
            validation_path = runtime_osm / "validation.json"
        artifact = _json(osm_artifact)
        manifest = _json(manifest_path)
        pois = artifact.get("pois", []) if artifact else []
        checksum_status = _checksum_status(checksum_root, manifest) if artifact else None
        if osm and osm.enabled and not artifact:
            warnings.append("enabled_without_built_artifact")
        if checksum_status is False:
            warnings.append("package_checksum_mismatch")
        validation = _json(validation_path) or []
        if isinstance(validation, dict):
            rejected = int(validation.get("rejected", 0))
            flagged = sum(item.get("code") not in {"unusable_source_record", "out_of_bounds", "duplicate_osm_record"} for item in validation.get("warnings", []))
        else:
            rejected = sum(item.get("validationStatus") == "rejected" for item in validation)
            flagged = sum(item.get("validationStatus") == "flagged" for item in validation)
        spatial = _spatial_status(runtime_root, raw["id"]) if runtime_root else {"status": "not_checked"}
        regions.append({
            "regionId": raw["id"],
            "bbox": list(osm.bbox) if osm else raw.get("bbox"),
            "boundarySource": _boundary_source(raw),
            "primaryPoiSources": [source.get("id") for source in raw.get("sources", []) if source.get("provider") != "osm_overpass" and not source.get("layerRole")],
            "civicSource": f"app/regions/civic/{raw['id']}.json" if (regions_dir / "civic" / f"{raw['id']}.json").exists() else None,
            "journeySource": f"app/regions/{raw['id']}-journeys.json" if (regions_dir / f"{raw['id']}-journeys.json").exists() else None,
            "legacySupplementalSources": raw.get("supplementalPoiFiles", []) or ([raw["supplementalPoiFile"]] if raw.get("supplementalPoiFile") else []),
            "osmStatus": osm.status if osm else "invalid",
            "unavailableReason": osm.unavailable_reason if osm else None,
            "sourceConfigurationId": osm.source_id if osm else None,
            "recordCount": len(pois),
            "artifactStatus": "ready" if artifact else "missing",
            "recordCountsByCategory": dict(sorted(Counter(poi.get("category", "unknown") for poi in pois).items())),
            "validation": {"rejected": rejected, "flagged": flagged},
            "validationWarnings": warnings,
            "packagePath": str(checksum_root).replace("\\", "/") if checksum_root.exists() else None,
            "checksumStatus": "valid" if checksum_status else "missing" if checksum_status is None else "invalid",
            "spatialIndex": spatial,
        })
    return {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "canonicalSource": str(regions_dir).replace("\\", "/"),
        "summary": {
            "configuredRegions": len(regions),
            "enabled": sum(region["osmStatus"] == "enabled" for region in regions),
            "unavailable": sum(region["osmStatus"] == "unavailable" for region in regions),
            "built": sum(region["osmStatus"] == "enabled" and region["artifactStatus"] == "ready" and region["checksumStatus"] == "valid" for region in regions),
        },
        "regions": regions,
    }


def _boundary_source(region: dict[str, Any]) -> dict[str, Any]:
    boundary = next((source for source in region.get("sources", []) if source.get("layerRole") == "boundary"), None)
    if boundary:
        return {"type": "configured_boundary", "sourceId": boundary.get("id"), "url": boundary.get("url")}
    return {"type": "bbox", "value": region.get("bbox")}


def _json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _checksum_status(package: Path, manifest: dict[str, Any] | None) -> bool | None:
    if not manifest:
        return None
    for relative, expected in manifest.get("checksums", {}).items():
        path = package / relative
        if not path.exists() or f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}" != expected:
            return False
    return True


def _spatial_status(runtime_root: Path, region_id: str) -> dict[str, Any]:
    delta = runtime_root / "regions" / region_id / "osm" / "spatial-index-delta.json"
    if delta.exists():
        value = _json(delta) or {}
        return {"status": "delta_ready", "path": str(delta).replace("\\", "/"), "records": len(value.get("records", []))}
    candidates = [runtime_root / "regions" / region_id / "spatial", runtime_root / "regions" / region_id / "spatial-index"]
    directory = next((path for path in candidates if path.exists()), None)
    if not directory:
        return {"status": "unavailable", "reason": "No published spatial index directory."}
    manifest = next((path for path in (directory / "spatial-index-manifest.json", directory / "manifest.json") if path.exists()), None)
    return {"status": "ready" if manifest else "invalid", "path": str(directory).replace("\\", "/"), "manifest": manifest.name if manifest else None}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and audit regional OpenStreetMap enrichment.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("build", "coverage"):
        command = subparsers.add_parser(name)
        command.add_argument("--regions-dir", type=Path, default=Path("app/regions"))
        command.add_argument("--output", type=Path, default=Path("releases"))
    build = subparsers.choices["build"]
    build.add_argument("--cache", type=Path, default=Path(".gremlin-cache"))
    build.add_argument("--producer-version", default="development")
    build.add_argument("--generated-at")
    build.add_argument("--use-cache", action="store_true")
    build.add_argument("--only", nargs="*")
    build.add_argument("--runtime-root", type=Path)
    build.add_argument("--activate-after-build", action="store_true")
    coverage = subparsers.choices["coverage"]
    coverage.add_argument("--runtime-root", type=Path, default=Path("motherbird"))
    coverage.add_argument("--report", type=Path, default=Path("releases/osm-coverage-report.json"))
    args = parser.parse_args()
    if args.command == "build":
        timestamp = args.generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        result = build_all(args.regions_dir, args.output, args.cache, args.producer_version, timestamp, args.use_cache, args.runtime_root, args.activate_after_build, set(args.only) if args.only else None)
        args.output.mkdir(parents=True, exist_ok=True)
        report = args.output / "osm-build-report.json"
        report.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(report)
        return 1 if result["failed"] else 0
    report_value = coverage_report(args.regions_dir, args.output, args.runtime_root)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report_value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(args.report)
    return 1 if any(region["osmStatus"] == "invalid" for region in report_value["regions"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
