"""Validation for additive, map-viewable Journey packages."""

from __future__ import annotations

from collections.abc import Mapping
from math import isfinite
from typing import Any

from app.pipeline.contracts import ContractError, validate_release


def validate_linestring(geometry: Any) -> None:
    """Require a renderable WGS84 GeoJSON LineString."""
    if not isinstance(geometry, Mapping) or geometry.get("type") != "LineString":
        raise ContractError("Journey chapter geometry must be a GeoJSON LineString.")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise ContractError("Journey chapter LineString must contain at least two coordinates.")
    for index, coordinate in enumerate(coordinates):
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            raise ContractError(f"Journey coordinate {index} must be [longitude, latitude].")
        longitude, latitude = coordinate[0], coordinate[1]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) for value in (longitude, latitude)):
            raise ContractError(f"Journey coordinate {index} must contain finite numbers.")
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ContractError(f"Journey coordinate {index} is outside WGS84 bounds.")


def validate_journey_package(package: Mapping[str, Any]) -> None:
    """Validate compatibility POIs and every renderable Journey chapter."""
    validate_release(package)
    if package.get("pointsOfInterest") != package.get("pois"):
        raise ContractError("pointsOfInterest must exactly mirror pois for consumer compatibility.")
    journeys = package.get("journeys")
    if not isinstance(journeys, list):
        raise ContractError("journeys must be a list.")
    seen_ids: set[str] = set()
    for journey in journeys:
        if not isinstance(journey, Mapping) or not journey.get("id") or not journey.get("name"):
            raise ContractError("Each Journey requires an id and name.")
        if journey["id"] in seen_ids:
            raise ContractError(f"Duplicate Journey id: {journey['id']}")
        seen_ids.add(journey["id"])
        chapters = journey.get("chapters")
        if not isinstance(chapters, list) or not chapters:
            raise ContractError(f"Journey {journey['id']} requires at least one renderable chapter.")
        for chapter in chapters:
            if chapter.get("renderable") is not True:
                raise ContractError("Exported Journey chapters must be explicitly renderable.")
            validate_linestring(chapter.get("geometry"))
            provenance = chapter.get("geometryProvenance")
            if not isinstance(provenance, Mapping) or not provenance.get("sourceRecordId") or not provenance.get("sourceUrl") or not provenance.get("confidence"):
                raise ContractError("Every Journey chapter requires geometry provenance.")
            sources = chapter.get("sources")
            if not isinstance(sources, list) or not sources or any(not source.get("name") or not source.get("url") for source in sources):
                raise ContractError("Every Journey chapter requires named source metadata.")
