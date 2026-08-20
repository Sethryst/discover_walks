"""Build additive Journey packages from validated regional source geometry."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.pipeline.contracts import ContractError, validate_release
from app.pipeline.experience_scoring import calculate_duration_minutes
from app.pipeline.journey_contracts import validate_journey_package, validate_linestring


def build_journeys(
    region_id: str,
    editorial_file: Path,
    output_root: Path,
    producer_version: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Attach curated Journeys without changing the region's POI release."""
    bundle_dir = output_root / region_id
    pois_path = bundle_dir / "pois.json"
    canonical_path = bundle_dir / "supplemental" / "canonical-records.json"
    manifest_path = bundle_dir / "producer-manifest.json"
    for required in (editorial_file, pois_path, canonical_path, manifest_path):
        if not required.exists():
            raise FileNotFoundError(f"Required Journey input not found: {required}")

    release = _read_object(pois_path)
    validate_release(release)
    if release["regionId"] != region_id:
        raise ContractError(f"POI seed region {release['regionId']} does not match {region_id}.")
    editorial = _read_object(editorial_file)
    if editorial.get("regionId") != region_id:
        raise ContractError("Journey editorial regionId must match the release region.")
    records = json.loads(canonical_path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise ContractError("canonical-records.json must contain a list.")
    records_by_id = {record.get("id"): record for record in records if isinstance(record, dict) and record.get("id")}

    warnings: list[dict[str, str]] = []
    journeys: list[dict[str, Any]] = []
    for route in editorial.get("routes", []):
        chapters: list[dict[str, Any]] = []
        for index, part in enumerate(route.get("chapters", []), start=1):
            source_record_id = part.get("canonicalRecordId")
            record = records_by_id.get(source_record_id)
            if record is None:
                warnings.append(_warning("journey_geometry_missing", route, part, f"Canonical record not found: {source_record_id}"))
                continue
            geometry = record.get("geometry")
            try:
                validate_linestring(geometry)
            except ContractError as exc:
                warnings.append(_warning("journey_geometry_invalid", route, part, str(exc)))
                continue
            sources = _source_metadata(record, route, part)
            geometry_sources = [source for source in record.get("sources", []) if source.get("sourceName") and source.get("sourceUrl")]
            if not sources or not geometry_sources:
                warnings.append(_warning("journey_provenance_missing", route, part, "No public geometry-source metadata was available."))
                continue
            properties = record.get("properties", {})
            distance_meters = properties.get("estimatedDistanceMeters")
            if not isinstance(distance_meters, (int, float)) or distance_meters <= 0:
                distance_meters = _line_distance_meters(geometry["coordinates"])
            distance_miles = round(distance_meters / 1609.344, 2)
            source = geometry_sources[0]
            chapter = {
                "id": part.get("id") or f"{route['id']}-chapter-{index}",
                "name": part.get("name") or record.get("name") or "Unnamed chapter",
                "description": part.get("description", ""),
                "distanceMiles": distance_miles,
                "estimatedDurationMinutes": calculate_duration_minutes(distance_miles, float(part.get("elevationChangeFeet", 0)), part.get("stops", [])),
                "isLoop": bool(part.get("isLoop", False)),
                "amenities": part.get("amenities", []),
                "stops": part.get("stops", []),
                "renderable": True,
                "geometry": geometry,
                "geometryProvenance": {
                    "sourceRecordId": record["id"],
                    "sourceName": source.get("sourceName"),
                    "sourceUrl": source.get("sourceUrl"),
                    "confidence": source.get("confidence", "source_geometry"),
                    "method": "canonical-record-reference",
                    "generatedEstimate": False,
                },
                "sources": sources,
            }
            chapters.append(chapter)
        if not chapters:
            warnings.append({"code": "journey_not_renderable", "stage": "journey", "journeyId": str(route.get("id", "unknown")), "detail": "No chapter had valid source geometry and provenance."})
            continue
        journeys.append({
            "id": route["id"],
            "name": route["name"],
            "description": route.get("description", ""),
            "featured": bool(route.get("featured", False)),
            "regionId": region_id,
            "access": route.get("access"),
            "sources": _editorial_sources(route.get("sources", [])),
            "chapters": chapters,
        })

    producer = dict(release["producer"])
    if producer_version:
        producer["version"] = producer_version
    package = {
        "schemaVersion": 1,
        "regionId": region_id,
        "generatedAt": release["generatedAt"],
        "producer": producer,
        "pois": release["pois"],
        "pointsOfInterest": release["pois"],
        "journeys": journeys,
        "warnings": warnings,
    }
    validate_journey_package(package)

    package_bytes = _json_bytes(package)
    manifest = _read_object(manifest_path)
    manifest.setdefault("checksums", {})["supplemental/journeys.json"] = _checksum(package_bytes)
    existing_warnings = [warning for warning in manifest.setdefault("warnings", []) if warning.get("stage") != "journey"]
    manifest["warnings"] = [*existing_warnings, *warnings]
    if not dry_run:
        supplemental_dir = bundle_dir / "supplemental"
        supplemental_dir.mkdir(parents=True, exist_ok=True)
        (supplemental_dir / "journeys.json").write_bytes(package_bytes)
        manifest_path.write_bytes(_json_bytes(manifest))
    return {
        "destination": str(bundle_dir / "supplemental" / "journeys.json"),
        "journeys": len(journeys),
        "chapters": sum(len(journey["chapters"]) for journey in journeys),
        "cityPoisPreserved": len(release["pois"]),
        "warnings": warnings,
        "dryRun": dry_run,
    }


def _source_metadata(record: dict[str, Any], route: dict[str, Any], part: dict[str, Any]) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    for source in record.get("sources", []):
        if source.get("sourceName") and source.get("sourceUrl"):
            sources.append({"name": str(source["sourceName"]), "url": str(source["sourceUrl"]), "type": "geometry"})
    for source in [*route.get("sources", []), *part.get("sources", [])]:
        if source.get("name") and source.get("url"):
            sources.append({"name": str(source["name"]), "url": str(source["url"]), "type": str(source.get("type", "editorial"))})
    return list({(source["name"], source["url"], source["type"]): source for source in sources}.values())


def _editorial_sources(values: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [{"name": str(source["name"]), "url": str(source["url"]), "type": str(source.get("type", "editorial"))} for source in values if source.get("name") and str(source.get("url", "")).startswith("https://")]


def _warning(code: str, route: dict[str, Any], part: dict[str, Any], detail: str) -> dict[str, str]:
    return {"code": code, "stage": "journey", "journeyId": str(route.get("id", "unknown")), "chapter": str(part.get("name", "unknown")), "detail": detail}


def _line_distance_meters(coordinates: list[list[float]]) -> float:
    from app.pipeline.domains import _line_distance_meters as distance

    return distance(coordinates)


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError(f"Expected a JSON object in {path}.")
    return value


def _json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _checksum(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"
