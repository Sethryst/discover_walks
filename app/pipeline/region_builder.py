"""Complete build-time lifecycle for one configured region."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.pipeline.cache import cache_response, load_cached_response
from app.pipeline.civic import load_civic_artifacts
from app.pipeline.domains import AccessibilityGremlin, ArtGremlin, CoffeeGremlin, CommunityGremlin, DetourGremlin, EventGremlin, FacilitiesGremlin, HistoryGremlin, NatureGremlin, PantryGremlin, ParksGremlin, PlantGremlin, RestGremlin, RouteGremlin, ScenicGremlin, TrailsGremlin, WaterGremlin, WildlifeGremlin
from app.pipeline.entity_resolution import find_duplicate_candidates, reconcile_osm_records
from app.pipeline.export import build_release, write_bundle
from app.pipeline.geography import build_boundary_layer, verify_geographic_artifacts
from app.pipeline.nws import build_weather_snapshot
from app.pipeline.registry import ProviderRegistry
from app.pipeline.adapters.osm import OsmOverpassProvider
from app.pipeline.source_config import load_region
from app.pipeline.validation import _representative_coordinate, validate_records
from app.pipeline.wikimedia import WikimediaEnricher


GREMLINS = {"parks": ParksGremlin(), "trails": TrailsGremlin(), "route": RouteGremlin(), "facilities": FacilitiesGremlin(), "coffee": CoffeeGremlin(), "nature": NatureGremlin(), "water": WaterGremlin(), "community": CommunityGremlin(), "art": ArtGremlin(), "wildlife": WildlifeGremlin(), "plant": PlantGremlin(), "rest": RestGremlin(), "history": HistoryGremlin(), "scenic": ScenicGremlin(), "accessibility": AccessibilityGremlin(), "pantry": PantryGremlin(), "event": EventGremlin(), "detour": DetourGremlin()}


def build_region(region_file: Path, output_root: Path, cache_root: Path, producer_version: str, generated_at: str | None = None, dry_run: bool = False, use_cache: bool = False, only_sources: set[str] | None = None) -> dict[str, Any]:
    """Acquire, cache, process, validate, review, and publish a configured region release."""
    region = load_region(region_file)
    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    by_domain: dict[str, list[Any]] = defaultdict(list)
    source_reports: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    geography: dict[str, Any] = {}
    geography_manifest: list[dict[str, Any]] = []
    for source in region["sources"]:
        if only_sources and source.id not in only_sources:
            continue
        try:
            provider = ProviderRegistry.create(source)
            if use_cache and (isinstance(provider, OsmOverpassProvider) or source.layer_role or hasattr(provider, "parse")):
                try:
                    cache_path = _latest_cached_response(cache_root, region["id"], source.id)
                    raw_response = load_cached_response(cache_path)
                    features = provider.parse(raw_response, source, timestamp) if hasattr(provider, "parse") else []
                except FileNotFoundError:
                    features, raw_response = provider.acquire(source, region)
                    cache_path = cache_response(cache_root, region["id"], source.id, raw_response, timestamp)
            else:
                features, raw_response = provider.acquire(source, region)
                cache_path = cache_response(cache_root, region["id"], source.id, raw_response, timestamp)
            if isinstance(provider, OsmOverpassProvider):
                # The release timestamp, not wall-clock acquisition timing,
                # controls derived bytes for a fixed raw snapshot.
                features = provider.parse(raw_response, source, timestamp)
                warnings.extend(getattr(provider, "warnings", []))
            if source.layer_role:
                artifact, layer_warnings = build_boundary_layer(raw_response, source, region["id"], timestamp, cache_path)
                artifact_name = source.artifact_name or f"{source.layer_role}.geojson"
                geography[artifact_name] = artifact
                warnings.extend(layer_warnings)
                geography_manifest.append({
                    "role": source.layer_role,
                    "filename": f"geography/{artifact_name}",
                    "featureCount": len(artifact["features"]),
                    "idField": "id",
                    "nameField": "name",
                    "sourceId": source.id,
                })
                source_reports.append({"id": source.id, "name": source.name, "url": source.url, "provider": source.provider, "layerRole": source.layer_role, "licenseUrl": source.license_url, "authorityTier": source.authority_tier, "recordCount": len(artifact["features"]), "cachedAt": str(cache_path), "acquiredAt": timestamp})
                continue
            for domain in source.domains:
                by_domain[domain].extend(features)
            source_reports.append({"id": source.id, "name": source.name, "url": source.url, "provider": source.provider, "licenseUrl": source.license_url, "authorityTier": source.authority_tier, "recordCount": len(features), "cachedAt": str(cache_path), "acquiredAt": timestamp})
        except Exception as exc:
            warnings.append({"code": "source_unavailable", "source": source.id, "detail": str(exc)})
    if not source_reports:
        raise RuntimeError("No approved source succeeded; refusing to replace an existing release.")
    weather_snapshot: dict[str, Any] | None = None
    if not only_sources:
        try:
            weather_snapshot, weather_report = build_weather_snapshot(region, timestamp)
            source_reports.append(weather_report)
        except Exception as exc:
            warnings.append({"code": "source_unavailable", "source": "nws-forecast", "detail": str(exc)})
    records = [record for domain, features in by_domain.items() for record in GREMLINS[domain].process(features)]
    if region.get("enrichment", {}).get("wikimedia", {}).get("enabled"):
        warnings.extend(WikimediaEnricher().enrich(records, cache_root, region["id"], timestamp))
    records, validation_report = validate_records(records, region["bbox"])
    dedup_groups = find_duplicate_candidates(records)
    osm_records = [record for record in records if record["id"].startswith("osm:")]
    records, reconciliation_warnings = reconcile_osm_records(records)
    warnings.extend(reconciliation_warnings)
    public_pois = [_public_poi(record) for record in records if record["validationStatus"] != "rejected" and _representative_coordinate(record["geometry"]) is not None]
    release, manifest = build_release(region["id"], public_pois, warnings, producer_version, timestamp)
    manifest["sources"] = source_reports
    manifest["geography"] = geography_manifest
    osm_pois = [_public_poi(record) for record in osm_records if record["validationStatus"] != "rejected" and _representative_coordinate(record["geometry"]) is not None]
    supplemental = {
        "canonical-records.json": _release_safe_records(records),
        "osm-pois.json": {"schemaVersion": 1, "regionId": region["id"], "generatedAt": timestamp, "sourceVintage": timestamp, "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0", "sourceConfigurationId": region["osm"]["sourceId"], "pois": sorted(osm_pois, key=lambda poi: poi["id"])},
        "validation-report.json": validation_report,
        "dedup-groups.json": dedup_groups,
    }
    if weather_snapshot is not None:
        supplemental["weather.json"] = weather_snapshot
    civic = load_civic_artifacts(region["id"], producer_version, timestamp)
    destination = write_bundle(output_root, release, manifest, dry_run=dry_run, supplemental=supplemental, civic=civic, geography=geography)
    verified_geography = {} if dry_run else verify_geographic_artifacts(destination, manifest)
    return {"destination": str(destination), "records": len(records), "publicPois": len(public_pois), "osmPois": len(osm_pois), "geography": verified_geography, "warnings": warnings, "sources": source_reports}


def _latest_cached_response(cache_root: Path, region_id: str, source_id: str) -> Path:
    """Find the newest preserved raw source response for an explicit offline replay."""
    files = sorted((cache_root / region_id / source_id).glob("*.json"))
    if not files:
        raise FileNotFoundError(f"No raw cache available for {source_id}")
    return files[-1]


def _public_poi(record: dict[str, Any]) -> dict[str, Any]:
    lng, lat = _representative_coordinate(record["geometry"]) or (0.0, 0.0)
    properties = {key: value for key, value in record["properties"].items() if value not in (None, [], "")}
    category = {"parks": "park", "trails": "trail", "route": "route", "facilities": "facility", "coffee": "coffee", "nature": "nature", "water": "water", "community": "community", "art": "art", "wildlife": "wildlife", "plant": "plant", "rest": "rest", "history": "history", "scenic": "scenic", "accessibility": "accessibility", "pantry": "pantry", "event": "event", "detour": "detour"}[record["domain"]]
    return {"id": record["id"], "name": record["name"], "lat": lat, "lng": lng, "category": category, **properties, "source": [{"name": source["sourceName"], "id": source["sourceId"], "elementId": source.get("sourceElementId"), "url": source["sourceUrl"], "attribution": source.get("attribution"), "license": source.get("license"), "licenseUrl": source.get("licenseUrl"), "retrievedAt": source.get("retrievedAt")} for source in record["sources"]], "review": {"validationStatus": record["validationStatus"], "flags": record["validationFlags"], "dedupGroupId": record.get("dedup_group_id")}}


def _release_safe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose provenance in supplemental output without publishing raw attributes or personal data."""
    safe: list[dict[str, Any]] = []
    for record in records:
        copy = {**record, "sources": [{key: value for key, value in source.items() if key != "rawProperties"} for source in record["sources"]]}
        safe.append(copy)
    return safe
