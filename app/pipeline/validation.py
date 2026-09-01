"""Pluggable canonical-record validation with explicit quality outcomes."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ValidationFinding:
    """One schema, spatial, or domain-quality observation."""
    level: str
    field: str
    message: str
    severity: str


def validate_records(records: list[dict[str, Any]], bbox: list[float]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Annotate records and return a public validation summary without discarding flags."""
    summary: list[dict[str, Any]] = []
    for record in records:
        findings = _validate(record, bbox)
        errors = [finding for finding in findings if finding.level == "error"]
        warnings = [finding for finding in findings if finding.level == "warning"]
        record["validationStatus"] = "rejected" if errors else "flagged" if warnings else "valid"
        record["validationFlags"] = [finding.field for finding in findings]
        summary.append({"recordId": record["id"], "validationStatus": record["validationStatus"], "errors": [asdict(finding) for finding in errors], "warnings": [asdict(finding) for finding in warnings], "qualityScore": max(0, 100 - 40 * len(errors) - 10 * len(warnings))})
    return records, summary


def _validate(record: dict[str, Any], bbox: list[float]) -> list[ValidationFinding]:
    findings: list[ValidationFinding] = []
    if not record["name"].strip() or record["name"].startswith("Unnamed"):
        findings.append(ValidationFinding("error", "name", "A human-readable name is required.", "high"))
    geometry = record.get("geometry", {})
    geometry_type = geometry.get("type")
    permitted = {"parks": {"Point", "Polygon", "MultiPolygon"}, "trails": {"LineString", "MultiLineString"}, "route": {"LineString", "MultiLineString"}, "facilities": {"Point", "Polygon", "MultiPolygon"}, "coffee": {"Point"}, "cuisine": {"Point"}, "nature": {"Point"}, "water": {"Point"}, "community": {"Point"}, "art": {"Point"}, "wildlife": {"Point"}, "plant": {"Point"}, "rest": {"Point"}, "history": {"Point"}, "scenic": {"Point"}, "accessibility": {"Point"}, "pantry": {"Point"}, "event": {"Point"}, "detour": {"Point"}}
    if geometry_type not in permitted.get(record["domain"], set()):
        findings.append(ValidationFinding("error", "geometry", f"{record['domain']} does not accept {geometry_type} geometry.", "critical"))
    coordinate = _representative_coordinate(geometry)
    if coordinate is None:
        findings.append(ValidationFinding("error", "geometry", "Geometry has no usable coordinate.", "critical"))
    else:
        lng, lat = coordinate
        south, west, north, east = bbox
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            findings.append(ValidationFinding("error", "geometry", "Coordinates are outside WGS84 limits.", "critical"))
        elif not (south <= lat <= north and west <= lng <= east):
            findings.append(ValidationFinding("warning", "geometry", "Feature is outside configured region bounds.", "medium"))
    return findings


def _representative_coordinate(geometry: dict[str, Any]) -> tuple[float, float] | None:
    coordinates = geometry.get("coordinates")
    while isinstance(coordinates, list) and coordinates and isinstance(coordinates[0], list):
        coordinates = coordinates[0]
    if isinstance(coordinates, list) and len(coordinates) >= 2:
        return float(coordinates[0]), float(coordinates[1])
    return None
