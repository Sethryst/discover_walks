"""Explainable deterministic quality scoring for regional POI packages."""
from __future__ import annotations

from dataclasses import dataclass
from .package_intelligence import POIRecord, RegionalNeed, validate_poi
from .models import EventEvidence


@dataclass(frozen=True)
class QualityScore:
    completeness: float
    geometry: float
    provenance: float
    frontend_fit: float
    freshness: float
    total: float
    rationale: tuple[str, ...]


@dataclass(frozen=True)
class EventQualityScore:
    identity: float
    timing: float
    provenance: float
    geometry: float
    freshness: float
    total: float
    rationale: tuple[str, ...]


def score_event(event: EventEvidence, now_date: str) -> EventQualityScore:
    """Score event evidence without deciding whether it may be published."""
    identity = 1.0 if event.title.strip() and (event.stable_id or event.official_url) else 0.0
    timing = 1.0 if event.start and "invalid start timestamp" not in event.warnings and not event.expired else 0.0
    provenance = 1.0 if event.official_url.startswith(("https://", "http://")) and event.source_url.startswith(("https://", "http://")) else 0.0
    geometry = 1.0 if event.latitude is not None and event.longitude is not None else 0.0
    freshness = 1.0 if event.retrieved_at else 0.0
    rationale = []
    if not identity: rationale.append("missing stable identity or title")
    if not timing: rationale.append("missing, invalid, or expired start")
    if not provenance: rationale.append("missing official or source URL provenance")
    if not geometry: rationale.append("missing coordinates")
    if not freshness: rationale.append("missing retrieval timestamp")
    if not rationale: rationale.append("validated event identity, timing, provenance, geometry, and freshness")
    total = round((identity + timing + provenance + geometry + freshness) / 5, 3)
    return EventQualityScore(identity, timing, provenance, geometry, freshness, total, tuple(rationale))


def score_poi(record: POIRecord, need: RegionalNeed) -> QualityScore:
    errors = validate_poi(record)
    completeness = 1.0 if record.name and record.canonical_category else 0.0
    geometry = 1.0 if record.latitude is not None and record.longitude is not None else 0.0
    provenance = 1.0 if record.source_url.startswith(("https://", "http://")) else 0.0
    required = {r.canonical_category for r in need.requirements}
    frontend_fit = 1.0 if record.canonical_category in required else 0.0
    freshness = 1.0 if record.source_updated_at else 0.5
    rationale = tuple(errors) or ("validated identity and provenance",)
    total = round((completeness + geometry + provenance + frontend_fit + freshness) / 5, 3)
    return QualityScore(completeness, geometry, provenance, frontend_fit, freshness, total, rationale)
