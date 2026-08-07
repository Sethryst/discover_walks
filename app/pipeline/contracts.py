"""Versioned, dependency-free release contract validation."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any


SCHEMA_VERSION = 1
REQUIRED_POI_FIELDS = ("id", "name", "lat", "lng", "category")


class ContractError(ValueError):
    """Raised when a release cannot satisfy the public packaging contract."""


def validate_poi(poi: Mapping[str, Any]) -> None:
    """Validate a public POI without discarding allowed extension fields."""
    missing = [field for field in REQUIRED_POI_FIELDS if not poi.get(field) and poi.get(field) != 0]
    if missing:
        raise ContractError(f"POI is missing required fields: {', '.join(missing)}")
    if not isinstance(poi["id"], str) or not isinstance(poi["name"], str) or not isinstance(poi["category"], str):
        raise ContractError("POI id, name, and category must be strings.")
    for field, lower, upper in (("lat", -90, 90), ("lng", -180, 180)):
        value = poi[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not lower <= value <= upper:
            raise ContractError(f"POI {poi['id']} has invalid {field}: {value!r}")


def validate_release(release: Mapping[str, Any]) -> None:
    """Validate the complete version-one public POI bundle contract."""
    if release.get("schemaVersion") != SCHEMA_VERSION:
        raise ContractError(f"Expected schemaVersion {SCHEMA_VERSION}.")
    if not isinstance(release.get("regionId"), str) or not release["regionId"]:
        raise ContractError("regionId is required.")
    if not isinstance(release.get("producer"), Mapping) or not release["producer"].get("name") or not release["producer"].get("version"):
        raise ContractError("producer.name and producer.version are required.")
    try:
        datetime.fromisoformat(str(release.get("generatedAt", "")).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError("generatedAt must be ISO-8601.") from exc
    pois = release.get("pois")
    if not isinstance(pois, list):
        raise ContractError("pois must be a list.")
    seen_ids: set[str] = set()
    for poi in pois:
        if not isinstance(poi, Mapping):
            raise ContractError("Each POI must be an object.")
        validate_poi(poi)
        if poi["id"] in seen_ids:
            raise ContractError(f"Duplicate POI id: {poi['id']}")
        seen_ids.add(poi["id"])
