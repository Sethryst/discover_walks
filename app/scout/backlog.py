"""Build one review backlog from every governed regional source registry."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.scout.engine import ScoutEngine


DOMAIN_TO_CATEGORY = {
    "event": "events", "events": "events", "meeting": "meetings", "meetings": "meetings",
    "volunteer": "volunteer", "parks": "parks", "trails": "recreation", "route": "recreation",
    "facilities": "publicSpaces", "community": "publicSpaces", "art": "culturalActivities",
    "history": "culturalActivities", "pantry": "publicSpaces",
}


def build_backlog(workspace: Path, generated_at: str | None = None) -> dict[str, Any]:
    """Normalize registries, deduplicate leads, and run the existing scout for all regions."""
    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    regions_dir = workspace / "app" / "regions"
    region_configs = _region_configs(regions_dir)
    candidates: dict[str, list[dict[str, Any]]] = {region_id: [] for region_id in region_configs}
    omissions: list[dict[str, str]] = []

    for path in sorted((regions_dir / "candidates").glob("*.json")):
        payload = _read(path)
        region_id = payload.get("regionId")
        for source in payload.get("sources", []):
            _append(candidates, omissions, region_id, _candidate_from_source(source, timestamp, f"candidate_registry:{path.name}"))

    civic_path = regions_dir / "civic-source-priority.json"
    civic = _read(civic_path)
    for region_id, sources in civic.get("regions", {}).items():
        for category, url in sources.items():
            if category == "feed":
                category = "events"
            _append(candidates, omissions, region_id, _candidate_from_url(region_id, category, url, timestamp, f"civic_priority:{civic_path.name}"))

    event_path = regions_dir / "event-source-priority.json"
    for entry in _read(event_path).get("queue", []):
        _append(candidates, omissions, entry.get("regionId"), _candidate_from_url(
            entry.get("regionId"), "events", entry.get("url"), timestamp, f"event_priority:{event_path.name}",
            publisher=entry.get("source"), authority=entry.get("tier"), maintenance=[entry.get("nextStep", "")],
        ))

    editorial_path = regions_dir / "editorial-event-sources.json"
    for region_id, sources in _read(editorial_path).get("regions", {}).items():
        for source in sources:
            _append(candidates, omissions, region_id, _candidate_from_url(
                region_id, "events", source.get("url"), timestamp, f"editorial_registry:{editorial_path.name}",
                publisher=source.get("name"), authority=source.get("tier"), governance=[f"Free claim: {source.get('freeClaim', 'per_listing')}"]
            ))

    scout = ScoutEngine(workspace)
    region_results = []
    total_candidates = 0
    classifications: dict[str, int] = {"READY": 0, "INVESTIGATE": 0, "REJECT": 0}
    for region_id, config in sorted(region_configs.items()):
        unique = _deduplicate(candidates.get(region_id, []))
        result = scout.run(region_id, {"regionId": region_id, "candidates": unique}, timestamp)
        total_candidates += len(result["queue"])
        for item in result["queue"]:
            classifications[item["classification"]] += 1
        region_results.append({
            "id": region_id,
            "name": config["name"],
            "coverage": result["region"],
            "queue": result["queue"],
        })

    return {
        "schemaVersion": 1,
        "kind": "regional-source-review-backlog",
        "generatedAt": timestamp,
        "readOnly": True,
        "publicationPolicy": "Discovery never publishes app data. A reviewed provider, fixture, contract validation, and release build are required.",
        "summary": {"regionCount": len(region_results), "candidateCount": total_candidates, "classifications": classifications},
        "regions": region_results,
        "omissions": sorted(omissions, key=lambda item: (item.get("regionId", ""), item.get("reason", ""))),
    }


def _region_configs(regions_dir: Path) -> dict[str, dict[str, Any]]:
    configs = {}
    for path in sorted(regions_dir.glob("*.json")):
        try:
            value = _read(path)
        except (json.JSONDecodeError, OSError):
            continue
        if {"id", "name", "bbox"}.issubset(value):
            configs[value["id"]] = value
    return configs


def _candidate_from_source(source: dict[str, Any], timestamp: str, method: str) -> dict[str, Any]:
    domains = source.get("domains") or ["publicSpaces"]
    category = DOMAIN_TO_CATEGORY.get(domains[0], domains[0])
    provider = source.get("provider", "unknown")
    data_type = _data_type(source.get("url", ""), provider)
    structured = data_type != "HTML calendar"
    return {
        "id": source.get("id") or _candidate_id(category, source.get("url", "")),
        "url": source.get("url", ""),
        "publisher": source.get("name") or _publisher(source.get("url", "")),
        "category": category,
        "dataType": data_type,
        "authority": _authority(source.get("authorityTier"), source.get("url", "")),
        "coverageValue": "high" if category in {"events", "meetings", "volunteer", "parks", "recreation"} else "medium",
        "structureClarity": "clear" if structured else "unknown",
        "alignedProviderPattern": structured,
        "governance": [f"Registry status: {source.get('status', 'candidate')}", *(source.get("activationRequirements") or [])],
        "maintenance": [], "stability": [],
        "discovery": {"origin": "automated", "foundAt": timestamp, "method": method, "confidence": float(source.get("confidence", 0.8 if structured else 0.6))},
    }


def _candidate_from_url(region_id: str | None, category: str, url: str | None, timestamp: str, method: str, *, publisher: str | None = None, authority: str | None = None, governance: list[str] | None = None, maintenance: list[str] | None = None) -> dict[str, Any]:
    clean_url = str(url or "")
    data_type = _data_type(clean_url, "")
    structured = data_type != "HTML calendar"
    return {
        "id": _candidate_id(category, clean_url), "url": clean_url,
        "publisher": publisher or _publisher(clean_url), "category": DOMAIN_TO_CATEGORY.get(category, category),
        "dataType": data_type, "authority": _authority(authority, clean_url), "coverageValue": "high",
        "structureClarity": "clear" if structured else "unknown", "alignedProviderPattern": structured,
        "governance": governance or ["Discovery registry only"], "maintenance": [item for item in (maintenance or []) if item], "stability": [],
        "discovery": {"origin": "automated", "foundAt": timestamp, "method": method, "confidence": 0.82 if structured else 0.62},
    }


def _append(pool: dict[str, list[dict[str, Any]]], omissions: list[dict[str, str]], region_id: str | None, candidate: dict[str, Any]) -> None:
    if region_id not in pool:
        omissions.append({"regionId": str(region_id or "unknown"), "reason": "No governed region configuration exists for this lead."})
        return
    if not candidate.get("url", "").startswith("https://"):
        omissions.append({"regionId": str(region_id), "reason": f"Rejected non-HTTPS or empty candidate: {candidate.get('id', 'unknown')}"})
        return
    pool[region_id].append(candidate)


def _deduplicate(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items:
        key = (item["category"], _canonical_url(item["url"]))
        existing = by_key.get(key)
        if not existing or _candidate_quality(item) > _candidate_quality(existing):
            by_key[key] = item
    return list(by_key.values())


def _canonical_url(url: str) -> str:
    split = urlsplit(url)
    path = re.sub(r"/+$", "", split.path) or "/"
    return urlunsplit((split.scheme.lower(), split.netloc.lower(), path, split.query, ""))


def _candidate_quality(item: dict[str, Any]) -> tuple[int, float]:
    return (1 if item.get("structureClarity") == "clear" else 0, float(item.get("discovery", {}).get("confidence", 0)))


def _data_type(url: str, provider: str) -> str:
    text = f"{url} {provider}".lower()
    if "arcgis" in text or "featureserver" in text or "mapserver" in text: return "ArcGIS"
    if any(token in text for token in (".rss", "/rss", ".ics", "ical", "libcal")): return "RSS/ICS"
    if any(token in text for token in ("api/", "/api", ".json", "socrata")): return "JSON API"
    if "geojson" in text: return "GeoJSON"
    return "HTML calendar"


def _authority(value: str | None, url: str) -> str:
    text = str(value or "").lower()
    host = urlsplit(url).netloc.lower()
    if any(token in text for token in ("government", "federal", "state", "county", "city", "local")) or host.endswith(".gov"): return "government"
    if any(token in text for token in ("public_institution", "library")): return "public_institution"
    if any(token in text for token in ("partner", "organizer")): return "official_partner"
    if "editorial" in text: return "editorial"
    return "unknown"


def _publisher(url: str) -> str:
    return urlsplit(url).netloc.removeprefix("www.") or "Unknown publisher"


def _candidate_id(category: str, url: str) -> str:
    host = re.sub(r"[^a-z0-9]+", "-", _publisher(url).lower()).strip("-") or "source"
    digest = hashlib.sha256(_canonical_url(url).encode("utf-8")).hexdigest()[:8]
    return f"{category}-{host}-{digest}"


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the governed all-region source review backlog.")
    parser.add_argument("--workspace", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("expansion-queues/regional-source-backlog.json"))
    args = parser.parse_args()
    result = build_backlog(args.workspace)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {result['summary']['candidateCount']} candidates across {result['summary']['regionCount']} regions to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
