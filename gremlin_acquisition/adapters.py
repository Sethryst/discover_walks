"""Typed, replayable POI acquisition adapters for configured source formats."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .package_intelligence import POIRecord, normalize_poi, validate_poi


@dataclass(frozen=True)
class AdapterResult:
    provider: str
    source_url: str
    status: str
    records: tuple[POIRecord, ...] = ()
    errors: tuple[str, ...] = ()
    raw_sha256: str | None = None


@dataclass(frozen=True)
class FallbackResult:
    selected: AdapterResult | None
    attempts: tuple[AdapterResult, ...]
    status: str
    reason: str


def _category(config: dict, default="place") -> str:
    domains = config.get("domains") or []
    constants = (config.get("propertyMapping") or {}).get("constants") or {}
    return str(constants.get("type") or (config.get("category") if config.get("category") else (domains[0] if domains else default)))


def _record(config: dict, feature: dict, index: int) -> POIRecord:
    props = feature.get("properties") or {}
    mapping = config.get("propertyMapping") or {}
    record_id = props.get(mapping.get("id", "id")) or feature.get("id") or f"row-{index}"
    name = props.get(mapping.get("name", "name"))
    if not name:
        for fallback in mapping.get("nameFallbacks", []):
            if props.get(fallback):
                name = props[fallback]
                break
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    if geometry.get("x") is not None and geometry.get("y") is not None:
        lon, lat = geometry["x"], geometry["y"]
    elif geometry.get("type") == "Point" and len(coords) >= 2:
        lon, lat = coords[:2]
    else:
        lat = lon = None
    attributes = {key: props[key] for key in mapping.get("include", []) if key in props}
    attributes.update(mapping.get("constants", {}))
    category = props.get(mapping.get("category", "category")) or _category(config)
    return normalize_poi(POIRecord(str(record_id), str(name or ""), str(category), config["url"], lat, lon, attributes=attributes))


def parse_geojson(body: dict, config: dict) -> AdapterResult:
    features = body.get("features") or []
    records = tuple(_record(config, feature, i) for i, feature in enumerate(features))
    errors = tuple(f"{record.record_id}: {error}" for record in records for error in validate_poi(record))
    return AdapterResult("geojson", config["url"], "SUCCEEDED" if not errors else "PARTIAL", records, errors)


def parse_arcgis(body: dict, config: dict) -> AdapterResult:
    features = [{"type": "Feature", "properties": row.get("attributes", {}), "geometry": row.get("geometry") or {}}
                for row in body.get("features") or []]
    for feature, row in zip(features, body.get("features") or []):
        feature["id"] = row.get("attributes", {}).get((config.get("propertyMapping") or {}).get("id", "OBJECTID"))
    records = tuple(_record(config, feature, i) for i, feature in enumerate(features))
    errors = tuple(f"{record.record_id}: {error}" for record in records for error in validate_poi(record))
    return AdapterResult("arcgis_feature_service", config["url"], "SUCCEEDED" if not errors else "PARTIAL", records, errors)


def acquire(config: dict, transport: Callable[[str], str]) -> AdapterResult:
    """Acquire one configured source using an injected transport/replay body."""
    body = transport(config["url"])
    import json
    try:
        document = json.loads(body) if isinstance(body, str) else body
    except (TypeError, json.JSONDecodeError) as exc:
        return AdapterResult(config.get("provider", "unknown"), config["url"], "FAILED", errors=(f"invalid JSON: {exc}",))
    provider = config.get("provider", "geojson")
    if provider == "arcgis_feature_service" or "features" in document and "objectIdFieldName" in document:
        return parse_arcgis(document, config)
    return parse_geojson(document, config)


def acquire_with_fallback(configs, transport: Callable[[str], str]) -> FallbackResult:
    """Try equivalent configured sources in order and preserve every outcome."""
    attempts = []
    for config in configs:
        try:
            result = acquire(config, transport)
        except Exception as exc:  # provider boundary: keep failure auditable
            result = AdapterResult(config.get("provider", "unknown"), config.get("url", ""), "FAILED", errors=(str(exc),))
        attempts.append(result)
        if result.status == "SUCCEEDED" and result.records:
            reason = "selected first successful source with records"
            if len(attempts) > 1:
                reason += f" after {len(attempts) - 1} prior failure or empty attempt(s)"
            return FallbackResult(result, tuple(attempts), "SUCCEEDED", reason)
    if any(result.status == "PARTIAL" for result in attempts):
        return FallbackResult(next(result for result in attempts if result.status == "PARTIAL"), tuple(attempts), "PARTIAL", "all sources failed to provide a fully valid result")
    return FallbackResult(None, tuple(attempts), "FAILED", "all configured fallback sources failed or were empty")
