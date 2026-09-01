"""Canonical, explicit configuration for regional OpenStreetMap enrichment."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
DEFAULT_CATEGORIES = (
    "park",
    "trail",
    "water",
    "history",
    "public_art",
    "library",
    "community",
    "garden",
    "nature",
    "coffee",
    "markets",
    "restaurants",
    "rest",
)
OSM_ATTRIBUTION = "© OpenStreetMap contributors"
OSM_LICENSE = "ODbL-1.0"
OSM_LICENSE_URL = "https://www.openstreetmap.org/copyright"


@dataclass(frozen=True, slots=True)
class OsmConfig:
    """The one supported regional OSM configuration shape."""

    status: str
    enabled: bool
    bbox: tuple[float, float, float, float]
    source_id: str
    endpoint: str
    categories: tuple[str, ...]
    refresh_policy: str
    max_records: int
    clip_to_boundary_source_id: str | None = None
    unavailable_reason: str | None = None
    package_path: str | None = None

    def as_public_dict(self) -> dict[str, Any]:
        output = asdict(self)
        return {
            "status": output["status"],
            "enabled": output["enabled"],
            "bbox": list(output["bbox"]),
            "sourceId": output["source_id"],
            "endpoint": output["endpoint"],
            "categories": list(output["categories"]),
            "refreshPolicy": output["refresh_policy"],
            "maxRecords": output["max_records"],
            **({"clipToBoundarySourceId": output["clip_to_boundary_source_id"]} if output["clip_to_boundary_source_id"] else {}),
            **({"unavailableReason": output["unavailable_reason"]} if output["unavailable_reason"] else {}),
            **({"packagePath": output["package_path"]} if output["package_path"] else {}),
        }


def normalize_osm_config(region: dict[str, Any]) -> OsmConfig:
    """Validate canonical OSM state and fill only stable, documented defaults."""
    raw = region.get("osm")
    if not isinstance(raw, dict):
        raise ValueError(f"Region '{region.get('id', 'unknown')}' must explicitly declare osm status.")
    status = str(raw.get("status", "enabled" if raw.get("enabled") else "unavailable"))
    enabled = bool(raw.get("enabled", status == "enabled"))
    if status not in {"enabled", "unavailable"}:
        raise ValueError("osm.status must be 'enabled' or 'unavailable'.")
    if enabled != (status == "enabled"):
        raise ValueError("osm.enabled must agree with osm.status.")
    reason = raw.get("unavailableReason")
    if not enabled and (not isinstance(reason, str) or not reason.strip()):
        raise ValueError("An unavailable OSM package requires osm.unavailableReason.")
    bbox = tuple(float(value) for value in raw.get("bbox", region.get("bbox", ())))
    if len(bbox) != 4:
        raise ValueError("osm.bbox must contain south, west, north, east.")
    south, west, north, east = bbox
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise ValueError("osm.bbox is not a valid WGS84 bounding box.")
    categories = tuple(dict.fromkeys(raw.get("categories", DEFAULT_CATEGORIES)))
    unknown = set(categories) - set(DEFAULT_CATEGORIES)
    if unknown:
        raise ValueError(f"Unsupported OSM categories: {', '.join(sorted(unknown))}")
    max_records = int(raw.get("maxRecords", 2000))
    if not 1 <= max_records <= 20_000:
        raise ValueError("osm.maxRecords must be between 1 and 20000.")
    boundary_source_id = raw.get("clipToBoundarySourceId") or next((source.get("id") for source in region.get("sources", []) if "boundary" in str(source.get("layerRole", ""))), None)
    return OsmConfig(
        status=status,
        enabled=enabled,
        bbox=bbox,
        source_id=str(raw.get("sourceId") or f"osm-{region['id']}"),
        endpoint=str(raw.get("endpoint") or DEFAULT_ENDPOINT),
        categories=categories,
        refresh_policy=str(raw.get("refreshPolicy") or "monthly"),
        max_records=max_records,
        clip_to_boundary_source_id=str(boundary_source_id) if boundary_source_id else None,
        unavailable_reason=reason.strip() if isinstance(reason, str) else None,
        package_path=raw.get("packagePath"),
    )


def osm_source_dict(config: OsmConfig) -> dict[str, Any]:
    """Translate the canonical region block into the existing source registry contract."""
    return {
        "id": config.source_id,
        "name": "OpenStreetMap contributors",
        "provider": "osm_overpass",
        "url": config.endpoint,
        "domains": ["parks", "trails", "water", "history", "art", "community", "nature", "coffee", "cuisine", "rest"],
        "licenseUrl": OSM_LICENSE_URL,
        "attribution": OSM_ATTRIBUTION,
        "authorityTier": "community",
        "confidence": 0.7,
        "dataClass": "durable",
        "visibleValue": "Fills named cafes, markets, restaurants, nature, comfort, history, art, or water-access gaps without overriding official geometry.",
        "providerOptions": {
            "categories": list(config.categories),
            "maxRecords": config.max_records,
            "fullGeometry": True,
            **({"clipToBoundarySourceId": config.clip_to_boundary_source_id} if config.clip_to_boundary_source_id else {}),
        },
        "status": "active",
    }
