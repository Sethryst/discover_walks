"""Frontend-aware regional package planning and deterministic POI intelligence.

This module is deliberately pure: adapters provide records, while this layer
describes what the frontend needs, translates source categories, validates
minimum identity/geometry, deduplicates records, and computes changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
import math
import re
from pathlib import Path
from .models import Geography
from typing import Iterable


FRONTEND_CATEGORY_ALIASES = {
    "parks": "park", "park": "park", "green space": "park",
    "trails": "trail", "trail": "trail", "paths": "trail",
    "libraries": "library", "library": "library",
    "historic": "history", "historic sites": "history", "history": "history",
    "restaurants": "restaurants", "restaurant": "restaurants",
    "cuisine": "restaurants", "food": "restaurants",
    "news": "news", "current events": "event", "events": "event",
    "learning": "learn", "learn": "learn", "culture": "culture",
    "nature": "nature", "wildlife": "wildlife", "water": "water",
}


@dataclass(frozen=True)
class FeatureRequirement:
    category: str
    required: bool = True
    minimum_records: int = 1
    frontend_surface: str = "explore"

    @property
    def canonical_category(self) -> str:
        return FRONTEND_CATEGORY_ALIASES.get(self.category.strip().lower(), self.category.strip().lower())


@dataclass(frozen=True)
class RegionalNeed:
    geography_query: str
    geography_id: str | None
    requirements: tuple[FeatureRequirement, ...]
    discovered_from: str = "configured requirement"


@dataclass(frozen=True)
class RegionDiscovery:
    query: str
    status: str
    geography: Geography
    reason: str


DEFAULT_FRONTEND_REQUIREMENTS = (
    FeatureRequirement("park", frontend_surface="explore"),
    FeatureRequirement("trail", frontend_surface="explore"),
    FeatureRequirement("library", frontend_surface="learn"),
    FeatureRequirement("history", frontend_surface="learn"),
    FeatureRequirement("event", required=False, minimum_records=0, frontend_surface="news"),
    FeatureRequirement("news", required=False, minimum_records=0, frontend_surface="news"),
    FeatureRequirement("restaurants", required=False, minimum_records=0, frontend_surface="cuisine"),
    FeatureRequirement("nature", required=False, minimum_records=0, frontend_surface="explore"),
)


def discover_regions(queries: Iterable[str], geography_adapter, known_ids: Iterable[str] = ()) -> list[RegionDiscovery]:
    """Resolve proposed regions through the geography adapter without fabrication.

    The adapter is responsible for WKLS-backed resolution. A result is only a
    new region when it has a canonical ID and a supported administrative level;
    unresolved and ambiguous proposals remain visible as investigation rows.
    """
    known = set(known_ids)
    results: list[RegionDiscovery] = []
    seen_queries: set[str] = set()
    for raw_query in queries:
        query = " ".join(str(raw_query).split())
        if not query or query.casefold() in seen_queries:
            continue
        seen_queries.add(query.casefold())
        geography = geography_adapter.resolve(query)
        if not geography.id:
            status = "AMBIGUOUS" if geography.level == "ambiguous" else "UNRESOLVED"
            results.append(RegionDiscovery(query, status, geography, "no unique canonical WKLS identity"))
        elif geography.id in known:
            results.append(RegionDiscovery(query, "KNOWN", geography, "canonical identity already covered"))
        elif geography.level not in {"country", "state", "region", "county", "city", "place", "town"}:
            results.append(RegionDiscovery(query, "UNSUPPORTED LEVEL", geography, f"level {geography.level!r} is not a package scope"))
        else:
            results.append(RegionDiscovery(query, "NEW", geography, "unique canonical identity discovered"))
    return results


def needs_from_discoveries(discoveries: Iterable[RegionDiscovery], requirements=DEFAULT_FRONTEND_REQUIREMENTS) -> list[RegionalNeed]:
    """Create reviewable package needs only for uniquely discovered regions."""
    return [
        RegionalNeed(row.geography.name, row.geography.id, tuple(requirements), "verified region discovery")
        for row in discoveries if row.status == "NEW"
    ]


@dataclass
class POIRecord:
    record_id: str
    name: str
    category: str
    source_url: str
    latitude: float | None = None
    longitude: float | None = None
    official_url: str | None = None
    attributes: dict = field(default_factory=dict)
    source_updated_at: str | None = None

    @property
    def canonical_category(self) -> str:
        return FRONTEND_CATEGORY_ALIASES.get(self.category.strip().lower(), self.category.strip().lower())

    @property
    def identity_key(self) -> str:
        normalized = " ".join(self.name.casefold().split())
        if self.latitude is not None and self.longitude is not None:
            location = f"{self.latitude:.5f},{self.longitude:.5f}"
        else:
            location = "unknown"
        return sha256(f"{self.canonical_category}|{normalized}|{location}".encode()).hexdigest()[:24]


def normalize_poi(record: POIRecord) -> POIRecord:
    """Translate a source record into the frontend category vocabulary."""
    record.category = record.canonical_category
    record.name = " ".join(record.name.strip().split())
    return record


def validate_poi(record: POIRecord) -> list[str]:
    errors: list[str] = []
    if not record.name.strip():
        errors.append("missing name")
    if not record.source_url.startswith(("http://", "https://")):
        errors.append("invalid source URL")
    if record.latitude is not None and not -90 <= record.latitude <= 90:
        errors.append("latitude out of range")
    if record.longitude is not None and not -180 <= record.longitude <= 180:
        errors.append("longitude out of range")
    if (record.latitude is None) != (record.longitude is None):
        errors.append("partial coordinates")
    return errors


def _dedupe_name(value: str) -> str:
    """Create a conservative cross-source name key without fuzzy matching."""
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _distance_meters(left: POIRecord, right: POIRecord) -> float | None:
    if None in (left.latitude, left.longitude, right.latitude, right.longitude):
        return None
    lat = math.radians((left.latitude + right.latitude) / 2)
    dx = (right.longitude - left.longitude) * 111_320 * math.cos(lat)
    dy = (right.latitude - left.latitude) * 110_540
    return math.hypot(dx, dy)


def deduplicate_pois(records: Iterable[POIRecord], *, proximity_meters: float = 75) -> tuple[list[POIRecord], dict[str, list[str]]]:
    """Deduplicate in cheap stages before retaining a canonical record.

    Stage 1 uses upstream IDs, stage 2 uses category + normalized name, and
    stage 3 confirms same-name candidates are geographically close. This
    catches cross-source coordinate drift while avoiding an O(n²) comparison
    across a regional package. Records without coordinates only collapse when
    their normalized category/name pair is identical.
    """
    unique: dict[str, POIRecord] = {}
    duplicates: dict[str, list[str]] = {}
    by_record_id: dict[str, str] = {}
    by_name: dict[tuple[str, str], list[str]] = {}
    for original in records:
        record = normalize_poi(original)
        exact_key = record.identity_key
        name_key = (record.canonical_category, _dedupe_name(record.name))
        matched_key = by_record_id.get(record.record_id)
        if matched_key is None:
            for candidate_key in by_name.get(name_key, ()):
                candidate = unique[candidate_key]
                distance = _distance_meters(candidate, record)
                if distance is None or distance <= proximity_meters:
                    matched_key = candidate_key
                    break
        if matched_key is not None:
            duplicates.setdefault(matched_key, []).append(record.record_id)
            continue
        unique[exact_key] = record
        by_record_id[record.record_id] = exact_key
        by_name.setdefault(name_key, []).append(exact_key)
    return list(unique.values()), duplicates


def coverage_report(need: RegionalNeed, records: Iterable[POIRecord]) -> dict:
    rows = list(records)
    by_category = {r.canonical_category: 0 for r in need.requirements}
    for record in rows:
        if record.canonical_category in by_category:
            by_category[record.canonical_category] += 1
    gaps = [r.canonical_category for r in need.requirements if by_category.get(r.canonical_category, 0) < r.minimum_records]
    return {
        "geographyQuery": need.geography_query,
        "geographyId": need.geography_id,
        "discoveredFrom": need.discovered_from,
        "requiredCategories": [r.canonical_category for r in need.requirements],
        "counts": by_category,
        "gaps": gaps,
        "recordCount": len(rows),
        "quality": round((len(rows) - len(gaps)) / max(1, len(need.requirements)), 3),
    }


def diff_pois(previous: Iterable[POIRecord], current: Iterable[POIRecord]) -> dict:
    # Prefer the upstream stable record ID for change tracking.  A coordinate
    # correction must be an update, not a missing/new pair; identity keys are
    # still used as the cross-source fallback when IDs are not shared.
    before_rows = list(previous)
    after_rows = list(current)
    before = {r.record_id: r for r in before_rows}
    after = {r.record_id: r for r in after_rows}
    if not (set(before) & set(after)):
        before = {r.identity_key: r for r in before_rows}
        after = {r.identity_key: r for r in after_rows}
    return {
        "new": [r.record_id for key, r in after.items() if key not in before],
        "missing": [r.record_id for key, r in before.items() if key not in after],
        "unchanged": [r.record_id for key, r in after.items() if key in before and r.__dict__ == before[key].__dict__],
        "updated": [r.record_id for key, r in after.items() if key in before and r.__dict__ != before[key].__dict__],
    }


def need_from_region_config(config: dict) -> RegionalNeed:
    """Derive package requirements from an app region configuration.

    Source domains are treated as evidence of intended frontend coverage; the
    loader does not claim that a configured source has succeeded.
    """
    categories: set[str] = set()
    osm = config.get("osm") or {}
    categories.update(osm.get("categories") or [])
    for source in config.get("sources") or []:
        categories.update(source.get("domains") or [])
        constants = (source.get("propertyMapping") or {}).get("constants") or {}
        categories.update(v for k, v in constants.items() if k == "type")
    requirements = tuple(
        FeatureRequirement(category, required=category in {"park", "trail", "library", "history"})
        for category in sorted({FRONTEND_CATEGORY_ALIASES.get(c.lower(), c.lower()) for c in categories})
    )
    return RegionalNeed(
        geography_query=config.get("name") or config.get("id", ""),
        geography_id=config.get("id"),
        requirements=requirements,
        discovered_from="app/regions configuration",
    )


def load_region_needs(directory: str | Path) -> list[RegionalNeed]:
    """Load all region needs in stable filename order, ignoring non-region indexes."""
    rows: list[RegionalNeed] = []
    for path in sorted(Path(directory).glob("*.json")):
        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(config, dict) or not config.get("id") or not config.get("name"):
            continue
        need = need_from_region_config(config)
        if need.requirements:
            rows.append(need)
    return rows
