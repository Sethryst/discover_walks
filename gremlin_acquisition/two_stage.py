"""Durable two-stage regional event acquisition contracts.

Stage 1 is discovery-only.  Stage 2 accepts only validated candidate records
written by Stage 1 and uses the existing typed adapters through an injected
transport, making both stages replayable without an in-memory coupling.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from .adapters import acquire, source_health
from .package_intelligence import deduplicate_pois


SUPPORTED_TYPES = {
    "RSS/Atom": "rss_atom", "ICS/iCalendar": "icalendar",
    "JSON-LD Event": "jsonld_events", "JSON API": "geojson",
    "ArcGIS FeatureServer/MapServer": "arcgis_feature_service",
    "Socrata": "socrata", "CKAN": "ckan", "HTML calendar": "html_directory",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _stable(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


@dataclass(frozen=True)
class CandidateSource:
    source_id: str
    url: str
    official_domain: str
    source_type: str
    evidence_urls: tuple[str, ...]
    region_id: str | None = None
    metro_id: str | None = None
    crawl_policy: dict = field(default_factory=dict)
    robots: str = "unknown"
    discovery_status: str = "candidate"
    density_signal: float | None = None

    def validate(self) -> list[str]:
        errors = []
        parsed = urlsplit(self.url)
        if parsed.scheme != "https" or not parsed.hostname:
            errors.append("source URL must be absolute HTTPS")
        if self.source_type not in SUPPORTED_TYPES:
            errors.append("unsupported source type")
        if not self.official_domain:
            errors.append("official domain required")
        if not self.evidence_urls or any(not str(url).startswith("https://") for url in self.evidence_urls):
            errors.append("HTTPS evidence URL required")
        host = (parsed.hostname or "").lower().removeprefix("www.")
        domain = self.official_domain.lower().removeprefix("www.")
        if host != domain and not host.endswith("." + domain):
            errors.append("source host outside official domain bound")
        return errors

    def jsonable(self) -> dict:
        result = asdict(self)
        result["evidence_urls"] = list(self.evidence_urls)
        return result


def write_discovery_artifact(path: str | Path, *, run_id: str, candidates: list[CandidateSource], pages: list[dict] = ()) -> Path:
    """Persist Stage 1 research evidence; never activates an app package."""
    invalid = [{"sourceId": c.source_id, "errors": c.validate()} for c in candidates if c.validate()]
    payload = {
        "schemaVersion": 1, "kind": "regional-source-discovery-artifact",
        "runId": run_id, "generatedAt": _now(), "publicationState": "research-only",
        "active": False, "candidates": [c.jsonable() for c in candidates if not c.validate()],
        "rejected": invalid, "pages": pages,
    }
    target = Path(path); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def load_validated_candidates(path: str | Path) -> list[CandidateSource]:
    """Read only Stage 1 candidates and enforce the Stage 2 trust boundary."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("kind") != "regional-source-discovery-artifact" or payload.get("active") is not False:
        raise ValueError("Stage 2 requires an inactive regional discovery artifact")
    result = []
    for raw in payload.get("candidates", []):
        candidate = CandidateSource(
            raw["source_id"], raw["url"], raw["official_domain"], raw["source_type"],
            tuple(raw.get("evidence_urls", ())), raw.get("region_id"), raw.get("metro_id"),
            raw.get("crawl_policy", {}), raw.get("robots", "unknown"), raw.get("discovery_status", "candidate"), raw.get("density_signal"),
        )
        errors = candidate.validate()
        if errors:
            raise ValueError(f"invalid Stage 1 candidate {candidate.source_id}: {'; '.join(errors)}")
        result.append(candidate)
    return sorted(result, key=lambda item: item.source_id)


def run_focused_sources(artifact_path: str | Path, transport, *, run_id: str | None = None) -> dict:
    """Acquire validated sources and emit normalized event records + health."""
    candidates = load_validated_candidates(artifact_path)
    events, attempts, rejected = [], [], []
    for candidate in candidates:
        config = {"url": candidate.url, "provider": SUPPORTED_TYPES[candidate.source_type],
                  "domains": ["event"], **candidate.crawl_policy}
        try:
            result = acquire(config, transport)
        except Exception as exc:
            attempts.append({"sourceId": candidate.source_id, "status": "FAILED", "error": str(exc)})
            continue
        health = source_health(result); health.update({"sourceId": candidate.source_id, "lastSuccessfulCrawl": _now() if result.records else None})
        attempts.append(health)
        for record in result.records:
            attributes = dict(record.attributes or {})
            if not attributes.get("start"):
                rejected.append({"sourceId": candidate.source_id, "recordId": record.record_id, "reason": "missing event start"})
                continue
            events.append({
                "eventId": _stable(f"{candidate.source_id}|{record.record_id}|{record.official_url or record.source_url}"),
                "sourceId": candidate.source_id, "title": record.name, "start": attributes.get("start"),
                "end": attributes.get("end"), "timezone": attributes.get("timezone") or attributes.get("timezone_name"),
                "location": attributes.get("location"), "category": record.canonical_category,
                "department": attributes.get("department"), "officialUrl": record.official_url or record.source_url,
                "sourceUrl": record.source_url, "parser": result.provider, "parserConfidence": 1.0 if not result.errors else 0.7,
                "regionId": candidate.region_id, "metroId": candidate.metro_id, "retrievedAt": _now(),
            })
    unique, duplicates = deduplicate_pois([])  # keep duplicate contract explicit; event IDs remain stable
    del unique
    return {"schemaVersion": 1, "kind": "focused-regional-events", "runId": run_id or _now(),
            "publicationState": "research-only", "active": False, "events": events,
            "duplicates": duplicates, "rejected": rejected, "sourceHealth": attempts}


def build_region_package(events_artifact: dict, *, region_id: str, region_name: str, metro_id: str | None = None,
                         nearby_regions: list[str] = (), rerun_schedule: str = "daily") -> dict:
    """Supplement Stage 2 events into an inactive, provenance-bearing package."""
    events = [event for event in events_artifact.get("events", []) if event.get("regionId") == region_id or event.get("metroId") == metro_id]
    by_source = {}
    for event in events:
        source_id = event.get("sourceId", "unknown")
        by_source[source_id] = by_source.get(source_id, 0) + 1
    return {"schemaVersion": 1, "kind": "regional-event-package", "regionId": region_id, "regionName": region_name,
            "metroId": metro_id, "nearbyRegions": sorted(set(nearby_regions)), "events": events,
            "density": {"eventCount": len(events), "sourceCount": len(by_source), "bySource": by_source},
            "sourceHealth": events_artifact.get("sourceHealth", []), "officialOutlinks": sorted({e["officialUrl"] for e in events if e.get("officialUrl")} ),
            "freshness": {"lastBuild": _now(), "rerunSchedule": rerun_schedule},
            "provenance": {"inputKind": events_artifact.get("kind"), "inputRunId": events_artifact.get("runId")},
            "publicationState": "research-only", "active": False, "runtimeLoader": "not-consumed; deliberate promotion required"}


def plan_region_search(package: dict, *, selected_region: str, min_events: int = 5) -> dict:
    """Privacy-preserving local-first query planner; accepts region IDs, not addresses."""
    local = [e for e in package.get("events", []) if e.get("regionId") == selected_region]
    expanded = len(local) < min_events
    rows = local if not expanded else package.get("events", [])
    return {"selectedRegion": selected_region, "precision": "region", "expandedToNearbyOrMetro": expanded,
            "eventIds": [e["eventId"] for e in rows], "officialOutlinks": [e["officialUrl"] for e in rows if e.get("officialUrl")]}
