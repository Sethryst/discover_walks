"""Explainable deterministic quality scoring for regional POI packages."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from .package_intelligence import POIRecord, RegionalNeed, validate_poi, validate_region_geometry
from .models import EventEvidence


@dataclass(frozen=True)
class QualityScore:
    completeness: float
    geometry: float
    provenance: float
    frontend_fit: float
    freshness: float
    authority: float
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


def freshness_score(updated_at: str | None, *, today: date | None = None, max_age_days: int = 365) -> tuple[float, str | None]:
    """Score an ISO source date with deterministic age bands."""
    if not updated_at:
        return 0.5, "missing source update timestamp"
    try:
        parsed = datetime.fromisoformat(str(updated_at).replace('Z', '+00:00')).date()
    except ValueError:
        return 0.25, "invalid source update timestamp"
    reference = today or date.today()
    age = (reference - parsed).days
    if age < 0:
        return 0.75, "source update timestamp is in the future"
    if age <= max_age_days:
        return 1.0, None
    if age <= max_age_days * 2:
        return 0.5, f"source is {age} days old"
    return 0.25, f"source is stale at {age} days old"


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
    errors = validate_poi(record) + validate_region_geometry(record, need.bbox)
    completeness = 1.0 if record.name and record.canonical_category else 0.0
    geometry = 1.0 if record.latitude is not None and record.longitude is not None else 0.0
    provenance = 1.0 if record.source_url.startswith(("https://", "http://")) else 0.0
    required = {r.canonical_category for r in need.requirements}
    frontend_fit = 1.0 if record.canonical_category in required else 0.0
    freshness, freshness_note = freshness_score(record.source_updated_at)
    authority_tier = str(record.attributes.get("authorityTier", "unknown")).casefold()
    authority = {
        "federal": 1.0, "state_government": 1.0, "local_government": 1.0,
        "city_government": 1.0, "county_government": 1.0, "official": 0.9,
        "editorial": 0.6, "community": 0.5, "unknown": 0.35,
    }.get(authority_tier, 0.35)
    rationale = tuple(errors) or ("validated identity and provenance",)
    if freshness_note: rationale = rationale + (freshness_note,)
    if authority < 0.6: rationale = rationale + ("source authority is unknown or non-official",)
    total = round((completeness + geometry + provenance + frontend_fit + freshness + authority) / 6, 3)
    return QualityScore(completeness, geometry, provenance, frontend_fit, freshness, authority, total, rationale)
