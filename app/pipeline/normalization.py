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
        category, subcategory, classification = classify_osm_place(tags)
        poi: dict[str, Any] = {
            "id": f"osm:{element['type']}:{element['id']}",
            "name": name,
            "lat": lat,
            "lng": lng,
            "artifact_type": "pin",
            "category": category,
            "subcategory": subcategory,
            "classification": classification,
            "fromOsm": True,
            "sourceType": "osm_overpass",
            "osmElementType": element["type"],
            "osmElementId": str(element["id"]),
            "osmTags": {key: tags[key] for key in ("amenity", "shop", "cuisine", "surface", "wheelchair", "opening_hours", "outdoor_seating", "access", "seasonal", "drinking_water") if tags.get(key)},
            "source": [{"name": "OpenStreetMap", "id": source_config_id, "elementId": str(element["id"]), "url": f"https://www.openstreetmap.org/{element['type']}/{element['id']}", "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0", "licenseUrl": "https://www.openstreetmap.org/copyright", "retrievedAt": retrieved_at}],
        }
        for source_key, output_key in (("description", "description"),):
            if tags.get(source_key):
                poi[output_key] = tags[source_key]
        poi["tags"] = sorted({category, "osm", *tags.get("cuisine", "").split(";")} - {""})
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


def classify_osm_place(tags: dict[str, str]) -> tuple[str, str | None, dict[str, Any]]:
    """Classify an OSM place conservatively, retaining the evidence used.

    Explicit OSM feature tags win.  Names/descriptions are used only for
    distinctive place-type words; a proper name alone never creates a topic.
    """
    explicit = _category_from_tags(tags)
    if explicit:
        return explicit, _subcategory(tags, explicit), {"method": "explicit_osm_tag", "confidence": "high"}
    text = " ".join(str(tags.get(key, "")) for key in ("name", "description", "historic", "heritage")).strip()
    rules = (
        ("history", "historic_site", r"\b(historic|historical|house|mansion|manor|homestead|plantation|memorial|monument|landmark|museum|cemetery|fort|battlefield)\b"),
        ("art", "public_art", r"\b(gallery|theater|theatre|public art|sculpture|cultural center|cultural centre)\b"),
        ("park", "outdoors", r"\b(park|garden|trail|waterfront|nature|preserve)\b"),
        ("community", "civic_place", r"\b(library|community center|community centre|recreation center|recreation centre|pantry|wi[- ]?fi)\b"),
        ("restaurant", "food_place", r"\b(bakery|restaurant|market|food hall|food truck)\b"),
        ("coffee", "drink_place", r"\b(cafe|café|coffee|tea|juice|smoothie)\b"),
    )
    import re
    matches = [(category, subtype) for category, subtype, pattern in rules if re.search(pattern, text, re.I)]
    if len(matches) == 1:
        category, subtype = matches[0]
        return category, subtype, {"method": "strong_text_signal", "confidence": "high", "signal": subtype}
    if len(matches) > 1:
        return "community", None, {"method": "ambiguous_text_signal", "confidence": "review", "signals": [subtype for _, subtype in matches]}
    return "community", None, {"method": "fallback", "confidence": "review", "reason": "no meaningful category evidence"}


def _category(tags: dict[str, str]) -> str:
    """Backward-compatible category helper for callers that only need the id."""
    return classify_osm_place(tags)[0]


def _category_from_tags(tags: dict[str, str]) -> str | None:
    if tags.get("leisure") in {"park", "nature_reserve"}:
        return "park"
    if tags.get("highway") in {"path", "footway", "pedestrian"}:
        return "trail"
    if _is_coffee_stop(tags):
        return "coffee"
    if tags.get("amenity") == "library":
        return "library"
    if tags.get("amenity") == "marketplace" or tags.get("shop") in {"grocery", "supermarket", "convenience", "greengrocer", "farm", "food"}:
        return "market"
    if tags.get("amenity") in {"restaurant", "fast_food"}:
        return "restaurant"
    if tags.get("leisure") in {"garden", "playground", "dog_park", "splash_pad"}:
        return "garden"
    if tags.get("tourism") == "artwork":
        return "public_art"
    if tags.get("historic"):
        return "history"
    if tags.get("natural") == "beach":
        return "water"
    if tags.get("amenity") in {"drinking_water", "shelter", "toilets"}:
        return "rest"
    return None


def _subcategory(tags: dict[str, str], category: str) -> str | None:
    return tags.get("historic") or tags.get("leisure") or tags.get("amenity") or tags.get("shop") or category


def _is_coffee_stop(tags: dict[str, str]) -> bool:
    if tags.get("amenity") == "cafe" or tags.get("shop") == "coffee":
        return True
    cuisines = {value.strip().casefold() for value in str(tags.get("cuisine", "")).split(";")}
    name = str(tags.get("name", "")).casefold()
    return tags.get("amenity") == "fast_food" and (bool(cuisines & {"coffee", "coffee_shop", "donut"}) or any(brand in name for brand in ("dunkin", "tim hortons", "krispy kreme")))
