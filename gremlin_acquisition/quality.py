"""Explainable deterministic quality scoring for regional POI packages."""
from __future__ import annotations

from dataclasses import dataclass
from .package_intelligence import POIRecord, RegionalNeed, validate_poi


@dataclass(frozen=True)
class QualityScore:
    completeness: float
    geometry: float
    provenance: float
    frontend_fit: float
    freshness: float
    total: float
    rationale: tuple[str, ...]


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
