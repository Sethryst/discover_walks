"""Domain Gremlins turn intermediate features into provenance-preserving records."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable
import json
from math import asin, cos, radians, sin, sqrt
from typing import Any

from shapely.geometry import mapping, shape
from shapely.ops import linemerge, unary_union

from app.pipeline.intermediate import IntermediateFeature


class DomainGremlin(ABC):
    """Domain worker with source allowlist-aware filtering and mapping."""

    domain: str

    def process(self, features: Iterable[IntermediateFeature]) -> list[dict[str, Any]]:
        """Filter source features and produce canonical records without losing provenance."""
        output: list[dict[str, Any]] = []
        for feature in features:
            assigned = feature.metadata.get("sourceMetadata", {}).get("assignedDomains")
            if assigned and self.domain not in assigned:
                continue
            if self.accepts(feature):
                output.append(self.map(feature))
        return output

    @abstractmethod
    def accepts(self, feature: IntermediateFeature) -> bool:
        """Return whether a feature represents this domain."""

    def map(self, feature: IntermediateFeature) -> dict[str, Any]:
        """Create a canonical record with all original attributes kept under provenance."""
        properties = feature.properties
        source_metadata = feature.metadata.get("sourceMetadata", {})
        is_osm = feature.metadata.get("rawFormat") == "osm"
        name = _configured_property(feature, "name", "PARK_NAME", "PARKNAME", "NAME", "name", "FACILITY_NAME", "DESCRIPTION", "SITE_NAME", "TRLNAME", "TRAIL_NAME", "ADDITION_TRAIL_NAME")
        return {
            "id": f"osm:{source_metadata.get('osmType')}:{feature.source_id}" if is_osm else f"{self.domain}:{source_metadata['sourceConfigId']}:{feature.source_id}",
            "domain": self.domain,
            "name": name or f"Unnamed {self.domain}",
            "geometry": feature.geometry,
            "properties": {
                **self.attributes(properties),
                **({
                    "fromOsm": True,
                    "sourceType": "osm_overpass",
                    "osmElementType": source_metadata.get("osmType"),
                    "osmElementId": feature.source_id,
                    "osmTags": _observable_osm_tags(properties),
                    "tags": sorted({self.domain.rstrip("s"), "osm", *[value.strip() for value in str(properties.get("cuisine", "")).split(";") if value.strip()]}),
                } if is_osm else {}),
            },
            "sources": [{
                "sourceId": source_metadata.get("sourceConfigId", feature.source_id),
                "sourceElementId": feature.source_id,
                "sourceName": feature.source_name,
                "sourceUrl": feature.source_url,
                "confidence": feature.metadata["confidence"],
                "rawProperties": properties,
                "retrievedAt": feature.acquisition_timestamp,
                "extractedAt": feature.acquisition_timestamp,
                "attribution": source_metadata.get("attribution"),
                "license": source_metadata.get("license"),
                "licenseUrl": source_metadata.get("licenseUrl"),
                "authorityTier": feature.metadata.get("authorityTier", "community"),
                "version": None,
            }],
            "conflicts": [],
            "validationStatus": "valid",
            "validationFlags": [],
            "version": "1.0",
        }

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        """Map common descriptive attributes while raw properties remain preserved."""
        return {"address": _first(properties, "ADDRESS", "ADDRESS1", "addr:full"), "hours": _first(properties, "HOURS", "OPERATING_HOURS", "opening_hours")}


class ParksGremlin(DomainGremlin):
    """Produces parks, playgrounds, recreation areas, and green spaces."""
    domain = "parks"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return feature.geometry.get("type") in {"Polygon", "MultiPolygon", "Point"} and bool(_configured_property(feature, "name", "PARK_NAME", "PARKNAME", "NAME", "name"))

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output["type"] = _first(properties, "TYPE", "PARK_TYPE", "FACILITYTYPE") or "park"
        output["amenities"] = [name for name, key in (("restrooms", "RESTROOMS"), ("parking", "PARKING"), ("playground", "PLAYGROUND")) if _truthy(properties.get(key))]
        return output


class TrailsGremlin(DomainGremlin):
    """Produces named path, line, and trail network records."""
    domain = "trails"

    def process(self, features: Iterable[IntermediateFeature]) -> list[dict[str, Any]]:
        """Normalize configured regional-route segments under one canonical identity."""
        ordinary: list[IntermediateFeature] = []
        canonical: dict[tuple[str, str], list[IntermediateFeature]] = {}
        configs: dict[tuple[str, str], dict[str, Any]] = {}
        for feature in features:
            source_metadata = feature.metadata.get("sourceMetadata", {})
            config = source_metadata.get("providerOptions", {}).get("canonicalRoute")
            if config and _matches_canonical_route(feature.properties, config):
                key = (str(source_metadata.get("sourceConfigId")), str(config["routeId"]))
                canonical.setdefault(key, []).append(feature)
                configs[key] = config
            else:
                ordinary.append(feature)
        output = super().process(ordinary)
        for (source_id, route_id), route_features in canonical.items():
            accepted = [feature for feature in route_features if self.accepts(feature)]
            if not accepted:
                continue
            record = self.map(accepted[0])
            geometries = [shape(feature.geometry) for feature in accepted]
            merged = linemerge(unary_union(geometries)) if len(geometries) > 1 else geometries[0]
            config = configs[(source_id, route_id)]
            record["id"] = f"{self.domain}:{source_id}:{route_id}"
            record["name"] = str(config["routeName"])
            record["geometry"] = json.loads(json.dumps(mapping(merged)))
            record["properties"].update({
                "routeId": route_id,
                "routeName": str(config["routeName"]),
                "routeType": config.get("routeType"),
                "operator": config.get("operator"),
                "officialHours": config.get("officialHours"),
                "identityUrl": config.get("identityUrl"),
                "sourceSegmentCount": len(accepted),
                "sourceSegmentIds": sorted(feature.source_id for feature in accepted),
            })
            output.append(record)
        return output

    def accepts(self, feature: IntermediateFeature) -> bool:
        return feature.geometry.get("type") in {"LineString", "MultiLineString"} and bool(_configured_property(feature, "name", "NAME", "TRAIL_NAME", "TRLNAME", "ADDITION_TRAIL_NAME", "name"))

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        surface = _first(properties, "SURFACE_MATERIAL", "SURFACE_TYPE", "SurfaceType", "surface", "SI_SURFACE")
        if isinstance(surface, (int, float)) or str(surface or "").isdigit():
            surface = {1: "Concrete", 2: "Asphalt", 3: "Brick", 4: "Dirt or Gravel", 5: "Other"}.get(int(surface), str(surface))
        access = _first(properties, "ADA", "ada", "SI_ACCESSIBILITY")
        output.update({
            "surface": surface,
            "width": _first(properties, "WIDTH", "width", "SI_WIDTH"),
            "difficulty": _first(properties, "DIFFICULTY", "difficulty"),
            "stairs": _first(properties, "STEPS", "stairs"),
            "accessibility": {"ada": access} if access else None,
            "maintenance": _first(properties, "MAINTENANCE_RESPONSIBILITY", "TRAILOWNER", "Owner", "Maintenance"),
        })
        return output


class RouteGremlin(DomainGremlin):
    """Collect named, pedestrian-suitable route segments as featured-walk candidates."""
    domain = "route"
    max_segment_meters = 1600

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return feature.geometry.get("type") in {"LineString", "MultiLineString"} and bool(tags.get("name")) and (tags.get("highway") in {"path", "footway", "pedestrian"} or tags.get("route") in {"foot", "hiking"})

    def process(self, features: Iterable[IntermediateFeature]) -> list[dict[str, Any]]:
        """Split long routes into bounded, stable walking parts without changing source geometry."""
        output: list[dict[str, Any]] = []
        for feature in features:
            if not self.accepts(feature):
                continue
            parts = _split_route(feature.geometry["coordinates"], self.max_segment_meters)
            for index, coordinates in enumerate(parts, start=1):
                part_feature = IntermediateFeature(feature.source_id, feature.source_name, feature.source_url, {"type": "LineString", "coordinates": coordinates}, feature.properties, feature.acquisition_timestamp, feature.metadata)
                record = self.map(part_feature)
                distance = round(_line_distance_meters(coordinates))
                record["properties"].update({"sourceRouteName": feature.properties["name"], "partNumber": index, "partCount": len(parts), "estimatedDistanceMeters": distance})
                if len(parts) > 1:
                    record["id"] = f"{record['id']}:part-{index:03d}"
                    record["name"] = f"{record['name']} — part {index} of {len(parts)}"
                output.append(record)
        return output

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"type": properties.get("route") or properties.get("highway"), "surface": properties.get("surface"), "accessibility": {"wheelchair": properties.get("wheelchair")} if properties.get("wheelchair") else None, "routeCandidate": True})
        return output


class FacilitiesGremlin(DomainGremlin):
    """Produces civic recreation and visitor facilities."""
    domain = "facilities"

    def accepts(self, feature: IntermediateFeature) -> bool:
        return feature.geometry.get("type") in {"Point", "Polygon", "MultiPolygon"} and bool(_configured_property(feature, "name", "NAME", "FACILITY_NAME", "CENTER_NAME", "DESCRIPTION", "name"))

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({
            "type": _first(properties, "type", "TYPE", "FACILITY_TYPE") or "facility",
            "parking": _truthy(properties.get("PARKING")),
            "restrooms": _truthy(properties.get("RESTROOMS")),
            "drinkingWater": _truthy(properties.get("DRINKING_FOUNTAINS")),
            "trails": _truthy(properties.get("TRAILS")),
            "website": _first(properties, "WEBSITE_LINK", "website"),
        })
        return output


class CoffeeGremlin(DomainGremlin):
    """Select walk-supportive cafés from OSM without popularity or review rankings."""
    domain = "coffee"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return feature.geometry.get("type") == "Point" and bool(tags.get("name")) and (tags.get("amenity") == "cafe" or tags.get("shop") == "bakery")

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        score, reasons = _walk_relevance(properties)
        output.update({"type": "cafe" if properties.get("amenity") == "cafe" else "bakery", "walkRelevanceScore": score, "walkRelevanceReasons": reasons, "accessibility": {"wheelchair": properties.get("wheelchair")} if properties.get("wheelchair") else None, "outdoorSeating": properties.get("outdoor_seating")})
        return output


class CuisineGremlin(DomainGremlin):
    """Publish OSM markets and restaurants under existing Cuisine chips."""
    domain = "cuisine"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return feature.geometry.get("type") == "Point" and bool(tags.get("name")) and (tags.get("amenity") in {"marketplace", "restaurant", "fast_food"} or tags.get("shop") in {"grocery", "supermarket", "convenience"})

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({
            "type": "market" if properties.get("amenity") == "marketplace" or properties.get("shop") in {"grocery", "supermarket", "convenience"} else "restaurant",
            "cuisineChip": "markets" if properties.get("amenity") == "marketplace" or properties.get("shop") in {"grocery", "supermarket", "convenience"} else "restaurants",
            "accessibility": {"wheelchair": properties.get("wheelchair")} if properties.get("wheelchair") else None,
        })
        return output


def _first(properties: dict[str, Any], *names: str) -> str | None:
    for name in names:
        value = properties.get(name)
        if value not in (None, ""):
            return str(value)
    return None


def _configured_property(feature: IntermediateFeature, logical_name: str, *fallback_names: str) -> str | None:
    """Read an explicit source mapping first, then use established aliases."""
    mapping = feature.metadata.get("sourceMetadata", {}).get("propertyMapping", {})
    mapped_field = mapping.get(logical_name)
    if mapped_field and feature.properties.get(mapped_field) not in (None, ""):
        return str(feature.properties[mapped_field])
    return _first(feature.properties, *fallback_names)


def _truthy(value: Any) -> bool:
    return str(value).strip().casefold() in {"yes", "true", "y", "1"}


def _observable_osm_tags(properties: dict[str, Any]) -> dict[str, Any]:
    """Keep observations as source tags; their presence is never promoted to a guarantee."""
    allowed = {
        "access", "amenity", "artwork_type", "drinking_water", "highway", "historic",
        "leisure", "natural", "opening_hours", "outdoor_seating", "seasonal", "shop",
        "surface", "tourism", "waterway", "wheelchair",
    }
    return {key: properties[key] for key in sorted(allowed) if properties.get(key) not in (None, "")}


def _walk_relevance(properties: dict[str, Any]) -> tuple[int, list[str]]:
    """Score only observable OSM walk-support signals; unavailable evidence earns no points."""
    score = 0
    reasons: list[str] = []
    if _truthy(properties.get("outdoor_seating")):
        score += 2
        reasons.append("outdoor_seating")
    if properties.get("wheelchair") in {"yes", "limited"}:
        score += 2
        reasons.append("accessibility_tagged")
    if properties.get("opening_hours"):
        score += 2
        reasons.append("hours_published")
    if properties.get("shop") == "bakery":
        score += 1
        reasons.append("bakery_stop")
    return score, reasons


class NatureGremlin(DomainGremlin):
    """Collect named, publicly mapped nature and garden destinations."""
    domain = "nature"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return bool(tags.get("name")) and tags.get("leisure") in {"nature_reserve", "garden"}

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output["type"] = properties.get("leisure")
        output["seasonalSignals"] = _seasonal_signals(properties)
        return output


class WaterGremlin(DomainGremlin):
    """Collect named waterfront-access places that support a walking route."""
    domain = "water"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return bool(tags.get("name")) and (tags.get("natural") == "beach" or tags.get("leisure") == "slipway" or tags.get("waterSignalType") == "monitoring_location")

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output["type"] = properties.get("natural") or properties.get("leisure") or properties.get("site_type") or "monitoring_location"
        output["seasonalSignals"] = _seasonal_signals(properties)
        if properties.get("waterSignalType"):
            output["monitoringLocationId"] = properties.get("monitoring_location_number") or properties.get("id")
            output["agency"] = properties.get("agency_name")
        return output


class CommunityGremlin(DomainGremlin):
    """Collect named libraries and public markets as neighborhood walking anchors."""
    domain = "community"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        name = _configured_property(feature, "name", "DESCRIPTION", "NAME", "name")
        if feature.metadata.get("rawFormat") != "osm":
            return feature.geometry.get("type") == "Point" and bool(name)
        return bool(name) and tags.get("amenity") in {"library", "marketplace"}

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output["type"] = properties.get("amenity") or properties.get("type") or "library"
        return output


class ArtGremlin(DomainGremlin):
    """Collect named public artworks with clear OSM provenance."""
    domain = "art"

    def accepts(self, feature: IntermediateFeature) -> bool:
        return bool(feature.properties.get("name")) and feature.properties.get("tourism") == "artwork"

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output["type"] = "public_art"
        return output


class WildlifeGremlin(DomainGremlin):
    """Publish eBird hotspot locations with expiring, privacy-safe seasonal signals."""
    domain = "wildlife"

    def accepts(self, feature: IntermediateFeature) -> bool:
        properties = feature.properties
        name = _configured_property(feature, "name", "SITE_NAME", "locName", "name")
        destination_type = properties.get("signalType") or properties.get("hotspotType") or properties.get("site_id")
        return feature.geometry.get("type") == "Point" and bool(name) and bool(destination_type)

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        seasonal = []
        if properties.get("signalType") == "recent_hotspot_observations":
            seasonal.append({"type": "recent_bird_observations", "species": properties.get("recentSpecies", []), "observedAt": properties.get("latestObservationAt"), "expiresAt": properties.get("signalExpiresAt")})
        output.update({
            "type": "vbwt_site" if properties.get("site_id") else "birding_hotspot",
            "seasonalSignals": seasonal,
            "ebirdLocationId": properties.get("locId") or properties.get("site_ebird_site_id"),
            "access": properties.get("site_access"),
            "directions": properties.get("site_directions"),
            "description": properties.get("site_description"),
            "amenities": [label for label, key in (("parking", "Parking"), ("restrooms", "Restrooms"), ("hiking_trails", "Hiking_Trails"), ("accessible", "Handicap_Accessible")) if _truthy(properties.get(key))],
        })
        return output


class PlantGremlin(DomainGremlin):
    """Collect named plant, tree, and garden records with explicit phenology facts."""
    domain = "plant"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return bool(tags.get("name")) and (tags.get("natural") == "tree" or tags.get("leisure") == "garden")

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"type": properties.get("natural") or properties.get("leisure"), "species": properties.get("species") or properties.get("genus"), "seasonalSignals": _seasonal_signals(properties)})
        return output


class RestGremlin(DomainGremlin):
    """Collect named public rest infrastructure only when source facts are explicit."""
    domain = "rest"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return bool(tags.get("name")) and tags.get("amenity") in {"toilets", "drinking_water", "bench"}

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"type": properties.get("amenity"), "accessibility": {"wheelchair": properties.get("wheelchair")} if properties.get("wheelchair") else None})
        return output


class ScenicGremlin(DomainGremlin):
    """Collect mapped viewpoints and trailheads that create a reason to take a walk."""
    domain = "scenic"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return feature.geometry.get("type") == "Point" and bool(tags.get("name")) and (tags.get("tourism") == "viewpoint" or tags.get("information") == "trailhead")

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output["type"] = "viewpoint" if properties.get("tourism") == "viewpoint" else "trailhead"
        return output


class AccessibilityGremlin(DomainGremlin):
    """Publish only explicit accessibility facts from mapped public infrastructure."""
    domain = "accessibility"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        return feature.geometry.get("type") == "Point" and bool(tags.get("name")) and tags.get("wheelchair") in {"yes", "limited"}

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"wheelchair": properties.get("wheelchair"), "type": properties.get("amenity") or properties.get("tourism") or "accessible_place"})
        return output


class HistoryGremlin(DomainGremlin):
    """Collect named, source-backed historic markers and places."""
    domain = "history"

    def accepts(self, feature: IntermediateFeature) -> bool:
        tags = feature.properties
        name = _configured_property(feature, "name", "DESCRIPTION", "NAME", "name")
        if feature.metadata.get("rawFormat") != "osm":
            return feature.geometry.get("type") == "Point" and bool(name)
        return bool(name) and bool(tags.get("historic") or tags.get("heritage"))

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"type": properties.get("type") or properties.get("historic") or "historic_site", "historicalContext": {"wikidataId": properties.get("wikidata"), "wikipedia": properties.get("wikipedia")} if properties.get("wikidata") or properties.get("wikipedia") else None})
        return output


def _matches_canonical_route(properties: dict[str, Any], config: dict[str, Any]) -> bool:
    """Match route identity using configured official source fields and labels."""
    haystack = " ".join(str(properties.get(field) or "") for field in config.get("matchFields", ())).casefold()
    return any(str(term).casefold() in haystack for term in config.get("matchTerms", ()))


class PantryGremlin(DomainGremlin):
    """Publish only verified food-access records from approved official providers."""
    domain = "pantry"

    def accepts(self, feature: IntermediateFeature) -> bool:
        properties = feature.properties
        return (
            properties.get("serviceType") in {"food_pantry", "community_fridge", "meal_program"}
            or (properties.get("status") == "Active" and properties.get("category_type") in {"Food Site", "General Meal Site"})
        ) and bool(_first(properties, "name", "site_name", "NAME"))

    def map(self, feature: IntermediateFeature) -> dict[str, Any]:
        record = super().map(feature)
        record["name"] = _first(feature.properties, "name", "site_name", "NAME") or "Unnamed pantry"
        return record

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        category_type = properties.get("category_type")
        service_type = properties.get("serviceType") or ("food_pantry" if category_type == "Food Site" else "meal_program")
        output.update({
            "type": service_type,
            "eligibility": properties.get("eligibility"),
            "hours": _weekly_hours(properties) or output.get("hours"),
            "website": properties.get("website"),
            "status": properties.get("status"),
            "temporaryClosure": properties.get("temporary_closure"),
            "seasonallyClosed": properties.get("seasonally_closed"),
            "lastVerifiedAt": properties.get("lastVerifiedAt"),
            "freshnessExpiresAt": properties.get("freshnessExpiresAt"),
        })
        return output


class EventGremlin(DomainGremlin):
    """Publish official, bounded-time events as expiring walk destinations."""
    domain = "event"

    def accepts(self, feature: IntermediateFeature) -> bool:
        return bool(feature.properties.get("name")) and bool(feature.properties.get("startsAt")) and feature.geometry.get("type") == "Point"

    def map(self, feature: IntermediateFeature) -> dict[str, Any]:
        record = super().map(feature)
        record["name"] = str(feature.properties["name"])
        return record

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"type": properties.get("eventType", "event"), "startsAt": properties["startsAt"], "endsAt": properties.get("endsAt"), "freshnessExpiresAt": properties.get("endsAt"), "isFree": properties.get("isFree"), "officialUrl": properties.get("officialUrl"), "venueAddress": properties.get("venueAddress") or _first(properties, "ADDRESS", "ADDRESS1", "address", "addr:full")})
        return output


class DetourGremlin(DomainGremlin):
    """Publish active, official walking disruptions with explicit expiry."""
    domain = "detour"

    def accepts(self, feature: IntermediateFeature) -> bool:
        return feature.properties.get("status") == "active" and bool(feature.properties.get("name"))

    def attributes(self, properties: dict[str, Any]) -> dict[str, Any]:
        output = super().attributes(properties)
        output.update({"type": properties.get("impactType", "construction"), "startsAt": properties.get("startsAt"), "endsAt": properties.get("endsAt"), "freshnessExpiresAt": properties.get("endsAt")})
        return output


def _seasonal_signals(properties: dict[str, Any]) -> list[str]:
    """Pass through explicit seasonal/phenology tags; absence is intentionally silent."""
    values = [properties[key] for key in ("seasonal", "opening_hours", "leaf_cycle") if properties.get(key)]
    return [str(value) for value in values]


def _weekly_hours(properties: dict[str, Any]) -> dict[str, list[dict[str, str]]] | None:
    """Convert known city-feed weekday fields without exposing contact details."""
    days = (("mon", "monday"), ("tues", "tuesday"), ("wed", "wednesday"), ("thurs", "thursday"), ("fri", "friday"), ("sat", "saturday"), ("sun", "sunday"))
    schedule: dict[str, list[dict[str, str]]] = {}
    for prefix, day in days:
        windows = []
        for slot in (1, 2):
            start, end = properties.get(f"hours_{prefix}_start{slot}"), properties.get(f"hours_{prefix}_end{slot}")
            if start and end:
                windows.append({"start": str(start), "end": str(end)})
        if windows:
            schedule[day] = windows
    return schedule or None


def _split_route(coordinates: list[list[float]], maximum_meters: float) -> list[list[list[float]]]:
    """Split a WGS84 LineString at interpolated boundaries no longer than maximum_meters."""
    if len(coordinates) < 2:
        return [coordinates]
    parts: list[list[list[float]]] = []
    current = [list(coordinates[0])]
    used = 0.0
    start = list(coordinates[0])
    for finish in coordinates[1:]:
        finish = list(finish)
        leg_start = start
        remaining = _distance_meters(leg_start, finish)
        while used + remaining > maximum_meters:
            required = maximum_meters - used
            ratio = required / remaining
            boundary = [leg_start[0] + (finish[0] - leg_start[0]) * ratio, leg_start[1] + (finish[1] - leg_start[1]) * ratio]
            current.append(boundary)
            parts.append(current)
            current = [boundary]
            leg_start = boundary
            remaining = _distance_meters(leg_start, finish)
            used = 0.0
        current.append(finish)
        used += remaining
        start = finish
    if len(current) >= 2:
        parts.append(current)
    return parts


def _line_distance_meters(coordinates: list[list[float]]) -> float:
    return sum(_distance_meters(left, right) for left, right in zip(coordinates, coordinates[1:]))


def _distance_meters(left: list[float], right: list[float]) -> float:
    """Haversine distance for [longitude, latitude] pairs."""
    longitude1, latitude1, longitude2, latitude2 = map(radians, [left[0], left[1], right[0], right[1]])
    delta_latitude, delta_longitude = latitude2 - latitude1, longitude2 - longitude1
    return 6_371_000 * 2 * asin(sqrt(sin(delta_latitude / 2) ** 2 + cos(latitude1) * cos(latitude2) * sin(delta_longitude / 2) ** 2))
