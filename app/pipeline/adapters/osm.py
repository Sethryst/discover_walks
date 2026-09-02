"""OpenStreetMap Overpass provider for configuration-driven, tag-filtered acquisition."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class OsmOverpassProvider(SourceAdapter):
    """Acquire OSM features using an approved Overpass query template and preserve tags."""

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        """Run the configured tag query inside region bounds and create lossless features."""
        south, west, north, east = region["bbox"]
        categories = source.provider_options.get("categories", [])
        selectors = _selectors(categories)
        legacy_selector = source.provider_options.get("selector")
        if legacy_selector:
            selectors = [legacy_selector]
        if not selectors:
            raise ValueError(f"OSM source {source.id} requires providerOptions.categories or selector")
        # Bound the response at the source as well as during parsing.  Full way
        # geometry makes large metro queries needlessly expensive for a POI
        # package; Overpass-provided centers retain stable point placement.
        maximum = int(source.provider_options.get("maxRecords", 2000))
        chosen: dict[tuple[str, int], dict[str, Any]] = {}
        vintages: list[str] = []
        for tile_south, tile_west, tile_north, tile_east in _tiles(south, west, north, east):
            remaining = maximum - len(chosen)
            if remaining <= 0:
                break
            output = f"out tags center {remaining};"
            union = "".join(f"nwr{selector}({tile_south},{tile_west},{tile_north},{tile_east});" for selector in selectors)
            query = f"[out:json][timeout:90];({union});{output}"
            response = self._request_with_retries(source, query)
            vintage = response.get("osm3s", {}).get("timestamp_osm_base")
            if vintage:
                vintages.append(vintage)
            for element in response.get("elements", []):
                chosen.setdefault((str(element.get("type", "")), int(element.get("id", 0))), element)
        raw = {
            "version": 0.6,
            "generator": "Gremlin Lab deterministic bounded Overpass acquisition",
            "osm3s": {"timestamp_osm_base": max(vintages) if vintages else None},
            "elements": [chosen[key] for key in sorted(chosen)],
        }
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return self.parse(raw, source, timestamp), raw

    def _request_with_retries(self, source: SourceConfig, query: str) -> dict[str, Any]:
        """Use bounded retries and server-friendly backoff for transient Overpass failures."""
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                request = Request(source.url, data=urlencode({"data": query}).encode("utf-8"), headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Gremlin-Lab/1.0 (regional build pipeline)"})
                with urlopen(request, timeout=120) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    if payload.get("remark"):
                        raise OSError(f"Overpass returned an incomplete response: {payload['remark']}")
                    return payload
            except (OSError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(2**attempt)
        raise RetryableGremlinError(f"OSM acquisition failed for {source.id}: {last_error}") from last_error

    def parse(self, raw: dict[str, Any], source: SourceConfig, timestamp: str) -> list[IntermediateFeature]:
        """Convert a saved Overpass response into intermediate features for offline replay."""
        features: list[IntermediateFeature] = []
        self.warnings: list[dict[str, str]] = []
        maximum = int(source.provider_options.get("maxRecords", 2000))
        category_limits = {str(key): int(value) for key, value in source.provider_options.get("categoryLimits", {}).items()}
        category_counts: dict[str, int] = {}
        limited_categories: set[str] = set()
        elements = sorted(raw.get("elements", []), key=lambda item: (str(item.get("type", "")), int(item.get("id", 0))))
        for element in elements:
            geometry = _geometry(element)
            tags = dict(element.get("tags", {}))
            assigned_domain = _domain(tags, geometry)
            if geometry is None or not tags.get("name") or assigned_domain is None:
                reason = "invalid geometry" if geometry is None else "missing name" if not tags.get("name") else "ambiguous category"
                self.warnings.append({"code": "unusable_source_record", "source": source.id, "detail": f"OSM {element.get('type')} {element.get('id')} rejected: {reason}."})
                continue
            category = _category(tags)
            category_count = category_counts.get(category, 0)
            if category in category_limits and category_count >= category_limits[category]:
                limited_categories.add(category)
                continue
            category_counts[category] = category_count + 1
            element_type = str(element["type"])
            element_id = str(element["id"])
            features.append(IntermediateFeature(element_id, source.name, f"https://www.openstreetmap.org/{element_type}/{element_id}", geometry, tags, timestamp, {"rawFormat": "osm", "sourceMetadata": {"sourceConfigId": source.id, "osmType": element_type, "assignedDomains": [assigned_domain], "attribution": source.attribution or "© OpenStreetMap contributors", "license": "ODbL-1.0", "licenseUrl": source.license_url}, "confidence": source.confidence, "authorityTier": source.authority_tier}))
            if len(features) >= maximum:
                if len(elements) > maximum:
                    self.warnings.append({"code": "max_records_applied", "source": source.id, "detail": f"Deterministic regional limit of {maximum} records applied."})
                break
        for category in sorted(limited_categories):
            self.warnings.append({"code": "max_records_applied", "source": source.id, "detail": f"Deterministic {category} limit of {category_limits[category]} records applied."})
        return features


def _tiles(south: float, west: float, north: float, east: float) -> list[tuple[float, float, float, float]]:
    """Split only oversized configured bounds, visiting central tiles first deterministically."""
    area = (north - south) * (east - west)
    divisions = 4 if area > 0.5 else 1
    if divisions == 1:
        return [(south, west, north, east)]
    lat_step, lng_step = (north - south) / divisions, (east - west) / divisions
    center_lat, center_lng = (south + north) / 2, (west + east) / 2
    tiles = [
        (south + row * lat_step, west + column * lng_step, south + (row + 1) * lat_step, west + (column + 1) * lng_step)
        for row in range(divisions)
        for column in range(divisions)
    ]
    return sorted(tiles, key=lambda tile: (((tile[0] + tile[2]) / 2 - center_lat) ** 2 + ((tile[1] + tile[3]) / 2 - center_lng) ** 2, tile))


def _geometry(element: dict[str, Any]) -> dict[str, Any] | None:
    if "lat" in element and "lon" in element:
        return {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
    center = element.get("center")
    if center:
        return {"type": "Point", "coordinates": [center["lon"], center["lat"]]}
    if isinstance(element.get("geometry"), list):
        coordinates = [[point["lon"], point["lat"]] for point in element["geometry"] if "lon" in point and "lat" in point]
        if len(coordinates) >= 2:
            if coordinates[0] == coordinates[-1] and len(coordinates) >= 4:
                return {"type": "Polygon", "coordinates": [coordinates]}
            return {"type": "LineString", "coordinates": coordinates}
    return None


def _selectors(categories: list[str]) -> list[str]:
    mapping = {
        "park": '["leisure"~"^(park|nature_reserve)$"]["name"]',
        "trail": '["highway"~"^(path|footway|pedestrian)$"]["name"]',
        "water": '["natural"="beach"]["name"]',
        "history": '["historic"]["name"]',
        "public_art": '["tourism"="artwork"]["name"]',
        "library": '["amenity"="library"]["name"]',
        "community": '["amenity"="marketplace"]["name"]',
        "garden": '["leisure"="garden"]["name"]',
        "nature": (
            '["leisure"~"^(garden|playground|dog_park|splash_pad)$"]["name"]',
            '["leisure"="slipway"]["name"]',
        ),
        "coffee": (
            '["amenity"="cafe"]["name"]',
            '["shop"="coffee"]["name"]',
            '["amenity"="fast_food"]["cuisine"~"(^|;)(coffee_shop|coffee|donut)(;|$)"]["name"]',
            '["amenity"="fast_food"]["name"~"^(Dunkin|Tim Hortons|Krispy Kreme)",i]',
        ),
        "markets": (
            '["amenity"="marketplace"]["name"]',
            '["shop"~"^(grocery|supermarket|convenience|greengrocer|farm|food)$"]["name"]',
        ),
        "restaurants": '["amenity"~"^(restaurant|fast_food)$"]["name"]',
        "rest": '["amenity"~"^(drinking_water|shelter|toilets)$"]["name"]',
    }
    selectors: list[str] = []
    for category in categories:
        value = mapping.get(category, ())
        selectors.extend(value if isinstance(value, tuple) else (value,))
    return list(dict.fromkeys(selectors))


def _domain(tags: dict[str, Any], geometry: dict[str, Any] | None) -> str | None:
    if geometry is None:
        return None
    if tags.get("highway") in {"path", "footway", "pedestrian"}:
        return "trails"
    if tags.get("leisure") in {"park", "nature_reserve"}:
        return "parks"
    if tags.get("leisure") in {"garden", "playground", "dog_park", "splash_pad"}:
        return "nature"
    if tags.get("leisure") == "slipway":
        return "water"
    if tags.get("natural") == "beach":
        return "water"
    if tags.get("historic"):
        return "history"
    if tags.get("tourism") == "artwork":
        return "art"
    if tags.get("amenity") == "library":
        return "community"
    if _is_coffee_stop(tags):
        return "coffee"
    if tags.get("amenity") in {"marketplace", "restaurant", "fast_food"} or tags.get("shop") in {"grocery", "supermarket", "convenience", "greengrocer", "farm", "food"}:
        return "cuisine"
    if tags.get("amenity") in {"drinking_water", "shelter", "toilets"}:
        return "rest"
    return None


def _category(tags: dict[str, Any]) -> str:
    if _is_coffee_stop(tags):
        return "coffee"
    if tags.get("amenity") in {"restaurant", "fast_food"}:
        return "restaurants"
    if tags.get("amenity") == "marketplace" or tags.get("shop") in {"grocery", "supermarket", "convenience", "greengrocer", "farm", "food"}:
        return "markets"
    if tags.get("highway") in {"path", "footway", "pedestrian"}:
        return "trail"
    if tags.get("leisure") in {"park", "nature_reserve"}:
        return "park"
    if tags.get("historic"):
        return "history"
    return "other"


def _is_coffee_stop(tags: dict[str, Any]) -> bool:
    """Recognize a coffee-seeking stop before the general fast-food bucket."""
    if tags.get("amenity") == "cafe" or tags.get("shop") == "coffee":
        return True
    cuisines = {value.strip().casefold() for value in str(tags.get("cuisine", "")).split(";")}
    if tags.get("amenity") == "fast_food" and cuisines & {"coffee", "coffee_shop", "donut"}:
        return True
    name = str(tags.get("name", "")).casefold()
    return tags.get("amenity") == "fast_food" and any(brand in name for brand in ("dunkin", "tim hortons", "krispy kreme"))
