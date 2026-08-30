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
from app.pipeline.geography import apply_geographic_source_rules, build_boundary_layer, verify_geographic_artifacts
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
    boundary_artifacts: dict[str, dict[str, Any]] = {}
    geography_manifest: list[dict[str, Any]] = []
    successful_sources = 0
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
            features, rule_warnings = apply_geographic_source_rules(features, source, boundary_artifacts)
            warnings.extend(rule_warnings)
            if source.layer_role:
                artifact, layer_warnings = build_boundary_layer(raw_response, source, region["id"], timestamp, cache_path)
                artifact_name = source.artifact_name or f"{source.layer_role}.geojson"
                geography[artifact_name] = artifact
                boundary_artifacts[source.id] = artifact
                warnings.extend(layer_warnings)
                geography_manifest.append({
                    "role": source.layer_role,
                    "filename": f"geography/{artifact_name}",
                    "featureCount": len(artifact["features"]),
                    "idField": "id",
                    "nameField": "name",
                    "sourceId": source.id,
                })
                source_reports.append(_source_report(source, "success", features, timestamp, cache_path, layer_role=source.layer_role, record_count=len(artifact["features"])))
                successful_sources += 1
                continue
            for domain in source.domains:
                by_domain[domain].extend(features)
            source_reports.append(_source_report(source, "success", features, timestamp, cache_path))
            successful_sources += 1
        except Exception as exc:
            warnings.append({"code": "source_unavailable", "source": source.id, "detail": str(exc)})
            source_reports.append(_source_report(source, "source_unavailable", [], timestamp, error=str(exc)))
    if not successful_sources:
        raise RuntimeError("No approved source succeeded; refusing to replace an existing release.")
    weather_snapshot: dict[str, Any] | None = None
    if not only_sources:
        try:
            weather_snapshot, weather_report = build_weather_snapshot(region, timestamp)
            source_reports.append({**weather_report, "acquireStatus": "success", "namedCount": 0, "unnamedCount": 0, "geometryTypesAcquired": [], "geometryTypesSurvived": [], "dataClass": "temporal", "visibleValue": "Shows a short-lived weather and alert context beside a walk without becoming durable geometry."})
        except Exception as exc:
            warnings.append({"code": "source_unavailable", "source": "nws-forecast", "detail": str(exc)})
            source_reports.append({"id": "nws-forecast", "name": "National Weather Service forecast and alerts", "url": "https://api.weather.gov/", "provider": "nws", "acquireStatus": "source_unavailable", "recordCount": 0, "namedCount": 0, "unnamedCount": 0, "geometryTypesAcquired": [], "geometryTypesSurvived": [], "dataClass": "temporal", "visibleValue": "Would show short-lived weather and alert context beside a walk; this build could not acquire it.", "error": str(exc), "acquiredAt": timestamp})
    records = [record for domain, features in by_domain.items() for record in GREMLINS[domain].process(features)]
    if region.get("enrichment", {}).get("wikimedia", {}).get("enabled"):
        warnings.extend(WikimediaEnricher().enrich(records, cache_root, region["id"], timestamp))
    records, validation_report = validate_records(records, region["bbox"])
    dedup_groups = find_duplicate_candidates(records)
    osm_records = [record for record in records if record["id"].startswith("osm:")]
    records, reconciliation_warnings = reconcile_osm_records(records)
    warnings.extend(reconciliation_warnings)
    public_pois = [_public_poi(record) for record in records if record["validationStatus"] != "rejected" and _representative_coordinate(record["geometry"]) is not None]
    civic: dict[str, dict[str, Any]] = {}
    if not only_sources:
        try:
            civic = load_civic_artifacts(region["id"], producer_version, timestamp)
            civic_count = sum(len(artifact.get("items", [])) for artifact in civic.values())
            source_reports.append({"id": "fairfax_civic" if region["id"] == "fairfax-county-va" else f"{region['id']}-civic", "name": f"{region['name']} civic events", "url": "https://www.fairfaxcounty.gov/calendar/RssFeed.aspx?cal=1" if region["id"] == "fairfax-county-va" else "configured civic provider", "provider": "civic_rss", "acquireStatus": "success", "recordCount": civic_count, "namedCount": civic_count, "unnamedCount": 0, "geometryTypesAcquired": [], "geometryTypesSurvived": [], "dataClass": "temporal", "visibleValue": "Shows time-bounded public meetings or events separately from durable walk geometry.", "acquiredAt": timestamp})
        except Exception as exc:
            source_id = "fairfax_civic" if region["id"] == "fairfax-county-va" else f"{region['id']}-civic"
            warnings.append({"code": "source_unavailable", "source": source_id, "detail": str(exc)})
            source_reports.append({"id": source_id, "name": f"{region['name']} civic events", "url": "https://www.fairfaxcounty.gov/calendar/RssFeed.aspx?cal=1" if region["id"] == "fairfax-county-va" else "configured civic provider", "provider": "civic_rss", "acquireStatus": "source_unavailable", "recordCount": 0, "namedCount": 0, "unnamedCount": 0, "geometryTypesAcquired": [], "geometryTypesSurvived": [], "dataClass": "temporal", "visibleValue": "Would show time-bounded civic events separately; the durable package still built when this feed failed.", "error": str(exc), "acquiredAt": timestamp})
    _add_survival_counts(source_reports, records)
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
    scorecard = _build_source_scorecard(region, source_reports, records, public_pois, timestamp)
    destination = write_bundle(output_root, release, manifest, dry_run=dry_run, supplemental=supplemental, civic=civic, geography=geography, artifacts={"source-scorecard.json": scorecard})
    verified_geography = {} if dry_run else verify_geographic_artifacts(destination, manifest)
    return {"destination": str(destination), "records": len(records), "publicPois": len(public_pois), "osmPois": len(osm_pois), "geography": verified_geography, "warnings": warnings, "sources": source_reports}


def _source_report(source: Any, status: str, features: list[Any], timestamp: str, cache_path: Path | None = None, layer_role: str | None = None, record_count: int | None = None, error: str | None = None) -> dict[str, Any]:
    """Describe what acquisition yielded in terms useful to walk creation."""
    name_fields = tuple(filter(None, (source.property_mapping.get("name"), *source.property_mapping.get("nameFallbacks", ()), "name", "NAME", "DESCRIPTION", "SITE_NAME", "TRLNAME", "TRAIL_NAME")))
    named = sum(1 for feature in features if any(feature.properties.get(field) not in (None, "") for field in name_fields))
    report = {
        "id": source.id,
        "name": source.name,
        "url": source.url,
        "provider": source.provider,
        "licenseUrl": source.license_url,
        "authorityTier": source.authority_tier,
        "acquireStatus": status,
        "recordCount": len(features) if record_count is None else record_count,
        "namedCount": named,
        "unnamedCount": max(0, len(features) - named),
        "geometryTypesAcquired": sorted({feature.geometry.get("type") for feature in features if feature.geometry.get("type")}),
        "geometryTypesSurvived": [],
        "emittedRecordCount": 0,
        "dataClass": source.data_class,
        "visibleValue": source.visible_value or "No walker-visible value statement was configured; deprioritize this source.",
        "acquiredAt": timestamp,
    }
    if layer_role:
        report["layerRole"] = layer_role
    if cache_path:
        report["cachedAt"] = str(cache_path)
    if error:
        report["error"] = error
    return report


def _add_survival_counts(source_reports: list[dict[str, Any]], records: list[dict[str, Any]]) -> None:
    """Add post-Gremlin counts so the manifest does not confuse acquisition with value."""
    by_source: dict[str, dict[str, Any]] = defaultdict(lambda: {"ids": set(), "geometry": set(), "named": 0, "unnamed": 0})
    for record in records:
        if record.get("validationStatus") == "rejected":
            continue
        for source in record.get("sources", []):
            source_id = str(source.get("sourceId"))
            bucket = by_source[source_id]
            if record.get("id") not in bucket["ids"]:
                bucket["ids"].add(record.get("id"))
                bucket["geometry"].add(record.get("geometry", {}).get("type"))
                if record.get("name") and not str(record["name"]).startswith("Unnamed"):
                    bucket["named"] += 1
                else:
                    bucket["unnamed"] += 1
    for report in source_reports:
        bucket = by_source.get(str(report.get("id")), {"ids": set(), "geometry": set(), "named": 0, "unnamed": 0})
        report["emittedRecordCount"] = len(bucket["ids"])
        report["emittedNamedCount"] = bucket["named"]
        report["emittedUnnamedCount"] = bucket["unnamed"]
        report["geometryTypesSurvived"] = sorted(value for value in bucket["geometry"] if value)


def _build_source_scorecard(region: dict[str, Any], source_reports: list[dict[str, Any]], records: list[dict[str, Any]], public_pois: list[dict[str, Any]], timestamp: str) -> dict[str, Any]:
    """Build an honest, walk-utility scorecard beside the producer manifest."""
    valid_records = [record for record in records if record.get("validationStatus") != "rejected"]
    category_counts: dict[str, int] = defaultdict(int)
    for poi in public_pois:
        category_counts[str(poi["category"])] += 1
    anchors = [record for record in valid_records if record.get("domain") in {"parks", "history", "community", "facilities", "wildlife"}]
    trails = [record for record in valid_records if record.get("domain") == "trails"]
    durable_acquired = sum(int(report.get("recordCount", 0)) for report in source_reports if report.get("dataClass") == "durable" and report.get("acquireStatus") == "success" and not report.get("layerRole"))
    useful_percent = round(100 * len(public_pois) / durable_acquired, 1) if durable_acquired else 0.0
    wod = next((record for record in trails if record.get("properties", {}).get("routeId") == "wod"), None)
    wildlife_sources = {source.get("sourceId") for record in valid_records if record.get("domain") == "wildlife" for source in record.get("sources", [])}
    can_support_sequence = bool(trails) and all(category_counts.get(category, 0) for category in ("park", "history", "wildlife", "community"))
    configured = region.get("scorecard", {})
    rows = [{key: report.get(key) for key in ("id", "name", "provider", "acquireStatus", "recordCount", "namedCount", "unnamedCount", "emittedRecordCount", "emittedNamedCount", "emittedUnnamedCount", "geometryTypesAcquired", "geometryTypesSurvived", "visibleValue", "dataClass", "error") if report.get(key) is not None} for report in source_reports]
    return {
        "schemaVersion": 1,
        "regionId": region["id"],
        "generatedAt": timestamp,
        "packageKind": configured.get("packageKind", "region"),
        "swallowedTowns": configured.get("swallowedTowns", []),
        "conflictWinner": configured.get("conflictWinner"),
        "sources": rows,
        "walkCreationReadiness": {
            "walkUsefulPublicRecords": len(public_pois),
            "walkUsefulCategories": dict(sorted(category_counts.items())),
            "plausibleWalkAnchors": len(anchors),
            "trailLinearRecords": len(trails),
            "trailGeometryTypes": sorted({record.get("geometry", {}).get("type") for record in trails}),
            "canonicalWod": {"present": wod is not None, "recordId": wod.get("id") if wod else None, "sourceSegmentCount": wod.get("properties", {}).get("sourceSegmentCount") if wod else 0},
            "wildlifeDestinationSources": sorted(value for value in wildlife_sources if value),
            "acquiredDataUsefulPercent": useful_percent,
            "canSupportTrailToHistoryParkWildlifeCommunitySequence": can_support_sequence,
            "journeys": {"status": "pending_editorial_build", "featuredWalkCount": 0},
            "geographicDensity": "Not scored in this pass; no POI-to-trail graph or candidate generator was added.",
            "walkerVisibleGain": "Mother Bird can offer named official parks, trails, wildlife places, history, libraries, community facilities, and access amenities as the material for curated Fairfax walks.",
            "stillMissing": [
                "Verified entrances rather than some park centroids",
                "Consistent drinking-water coverage",
                "NPS Great Falls rows currently return null geometry; A1/4 supplies the named Great Falls trail lines used by this build",
                "Huntley Meadows has strong wildlife and amenity anchors, but no named official line survived TRAIL_NAME validation for an initial Journey",
                "More curated Journeys after the first featured set"
            ],
            "smallestNextFeature": "Add more editorial Journeys, then consider a tiny POI-within-N-meters-of-trail sidecar if Journey authoring shows a repeated need.",
        },
        "skippedThisPass": [
            "GTFS, walk-to-transit routing, and schedules",
            "Pedestrian crossings, curb ramps, and sidewalk connectivity graph",
            "NOVA Parks HTML alert scraping and W&OD town gazetteer",
            "USGS flood/condition engine and NWS CAP trail intersections",
            "Automatic walk candidates, POI-to-trail graph, record-level provenance store, and publisher refactors",
            "DCR and 2013 NVRPA geometry as load-bearing sources",
            "New provider adapters other than durable eBird hotspots"
        ]
    }


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
