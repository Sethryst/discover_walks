"""Pure source-record normalization and deterministic de-duplication."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def normalize_overpass(elements: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Normalize OSM elements into public POIs and structured unavailable-record warnings."""
    pois: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    for element in elements:
        tags = element.get("tags", {})
        name = tags.get("name")
        location = element if "lat" in element else element.get("center", {})
        if not name or "lat" not in location or "lon" not in location:
            warnings.append({"code": "unusable_source_record", "source": "openstreetmap-overpass", "detail": f"OSM {element.get('type')} {element.get('id')} lacks name or coordinates."})
            continue
        category = _category(tags)
        poi: dict[str, Any] = {
            "id": f"osm:{element['type']}:{element['id']}",
            "name": name,
            "lat": float(location["lat"]),
            "lng": float(location["lon"]),
            "category": category,
            "source": {"name": "OpenStreetMap", "id": f"{element['type']}/{element['id']}", "url": f"https://www.openstreetmap.org/{element['type']}/{element['id']}"},
        }
        for source_key, output_key in (("description", "description"), ("opening_hours", "hours"), ("wheelchair", "accessibility")):
            if tags.get(source_key):
                poi[output_key] = tags[source_key]
        if tags.get("cuisine"):
            poi["tags"] = sorted(set(tags["cuisine"].split(";")))
        pois.append(poi)
    return deduplicate(pois), warnings


def deduplicate(pois: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep deterministic source IDs while removing exact semantic duplicates."""
    chosen: dict[tuple[str, float, float], dict[str, Any]] = {}
    for poi in sorted(pois, key=lambda item: item["id"]):
        key = (poi["name"].casefold(), round(poi["lat"], 6), round(poi["lng"], 6))
        chosen.setdefault(key, poi)
    return sorted(chosen.values(), key=lambda item: item["id"])


def _category(tags: dict[str, str]) -> str:
    if tags.get("leisure") == "park":
        return "park"
    if tags.get("highway") == "path":
        return "trail"
    return "attraction"
