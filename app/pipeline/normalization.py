"""Pure source-record normalization and deterministic de-duplication."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def normalize_overpass(elements: Iterable[dict[str, Any]], source_config_id: str = "openstreetmap-overpass", retrieved_at: str = "1970-01-01T00:00:00Z", bbox: list[float] | None = None) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
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
        lat, lng = float(location["lat"]), float(location["lon"])
        if bbox:
            south, west, north, east = bbox
            if not (south <= lat <= north and west <= lng <= east):
                warnings.append({"code": "out_of_bounds", "source": source_config_id, "detail": f"OSM {element.get('type')} {element.get('id')} is outside the configured bbox."})
                continue
        category = _category(tags)
        poi: dict[str, Any] = {
            "id": f"osm:{element['type']}:{element['id']}",
            "name": name,
            "lat": lat,
            "lng": lng,
            "category": category,
            "fromOsm": True,
            "sourceType": "osm_overpass",
            "osmElementType": element["type"],
            "osmElementId": str(element["id"]),
            "osmTags": {key: tags[key] for key in ("surface", "wheelchair", "opening_hours", "outdoor_seating", "access", "seasonal", "drinking_water") if tags.get(key)},
            "source": [{"name": "OpenStreetMap", "id": source_config_id, "elementId": str(element["id"]), "url": f"https://www.openstreetmap.org/{element['type']}/{element['id']}", "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0", "licenseUrl": "https://www.openstreetmap.org/copyright", "retrievedAt": retrieved_at}],
        }
        for source_key, output_key in (("description", "description"),):
            if tags.get(source_key):
                poi[output_key] = tags[source_key]
        if tags.get("cuisine"):
            poi["tags"] = sorted(set(tags["cuisine"].split(";")))
        pois.append(poi)
    deduplicated, duplicate_warnings = deduplicate_with_warnings(pois, source_config_id)
    return deduplicated, [*warnings, *duplicate_warnings]


def deduplicate(pois: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep deterministic source IDs while removing exact semantic duplicates."""
    chosen: dict[tuple[str, float, float], dict[str, Any]] = {}
    for poi in sorted(pois, key=lambda item: item["id"]):
        key = (poi["name"].casefold(), round(poi["lat"], 6), round(poi["lng"], 6))
        chosen.setdefault(key, poi)
    return sorted(chosen.values(), key=lambda item: item["id"])


def deduplicate_with_warnings(pois: Iterable[dict[str, Any]], source_config_id: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Deterministically retain the first semantic duplicate and report every rejection."""
    chosen: dict[tuple[str, float, float], dict[str, Any]] = {}
    warnings: list[dict[str, str]] = []
    for poi in sorted(pois, key=lambda item: item["id"]):
        key = (poi["name"].casefold(), round(poi["lat"], 6), round(poi["lng"], 6))
        if key in chosen:
            warnings.append({
                "code": "duplicate_osm_record",
                "source": source_config_id,
                "detail": f"{poi['id']} duplicates {chosen[key]['id']}; the stable first record was retained.",
            })
            continue
        chosen[key] = poi
    return sorted(chosen.values(), key=lambda item: item["id"]), warnings


def _category(tags: dict[str, str]) -> str:
    if tags.get("leisure") in {"park", "nature_reserve"}:
        return "park"
    if tags.get("highway") in {"path", "footway", "pedestrian"}:
        return "trail"
    if tags.get("amenity") == "cafe":
        return "coffee"
    if tags.get("amenity") == "library":
        return "library"
    if tags.get("amenity") == "marketplace":
        return "community"
    if tags.get("leisure") == "garden":
        return "garden"
    if tags.get("tourism") == "artwork":
        return "public_art"
    if tags.get("historic"):
        return "history"
    if tags.get("natural") == "beach":
        return "water"
    if tags.get("amenity") in {"drinking_water", "shelter", "toilets"}:
        return "rest"
    return "community"
