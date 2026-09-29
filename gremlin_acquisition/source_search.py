"""Deterministic source-search contracts for package acquisition.

Network providers implement ``search``; this module owns query generation and
result classification so search behavior is replayable and auditable.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Iterable, Protocol
from urllib.parse import urlsplit

from .package_intelligence import RegionalNeed


@dataclass(frozen=True)
class SearchLine:
    geography_id: str | None
    geography_query: str
    category: str
    frontend_surface: str
    query: str
    provider: str


@dataclass(frozen=True)
class SearchResult:
    query: str
    provider: str
    status: str
    urls: tuple[str, ...] = ()
    categories_found: tuple[str, ...] = ()
    reason: str | None = None


def infer_provider(url: str, default: str = 'geojson') -> str:
    """Infer a safe adapter family from a discovered endpoint URL."""
    normalized = url.lower().split('?', 1)[0].rstrip('/')
    if normalized.endswith(('.ics', '.ical', '.ifb')):
        return 'icalendar'
    if 'featureserver' in normalized or 'mapserver' in normalized:
        return 'arcgis_feature_service'
    if '/collections/' in normalized and normalized.endswith('/items'):
        return 'ogc_records'
    if '/resource/' in normalized and normalized.endswith(('.json', '.csv')):
        return 'socrata'
    if normalized.endswith(('.json', '.geojson')) or 'api/' in normalized:
        return 'geojson'
    return default


def discover_ogc_collections(document: dict, catalog_url: str, *, default_domains=(),
                             authority_tier='unknown') -> list[dict]:
    """Convert an OGC API - Records collections response into proposals."""
    from urllib.parse import urljoin
    proposals = []
    for collection in document.get('collections') or ():
        if not isinstance(collection, dict) or not collection.get('id'):
            continue
        collection_id = str(collection['id'])
        links = collection.get('links') or []
        items_link = next((link.get('href') for link in links if link.get('rel') in {'items', 'data'} and link.get('href')), None)
        items_url = items_link or urljoin(catalog_url.rstrip('/') + '/', f'collections/{collection_id}/items')
        license_link = next((link.get('href') for link in links if link.get('rel') in {'license', 'describedby'} and link.get('href')), None)
        proposals.append({
            'provider': 'ogc_records', 'url': items_url, 'collection': collection_id,
            'title': collection.get('title') or collection_id,
            'description': collection.get('description'), 'licenseUrl': license_link or collection.get('license'),
            'domains': list(default_domains), 'discoveredFrom': catalog_url, 'status': 'PROPOSED',
            'authorityTier': authority_tier,
        })
    return sorted(proposals, key=lambda row: row['url'])


def candidate_source_configs(results: Iterable[SearchResult], *, provider='geojson') -> list[dict]:
    """Turn search evidence into deterministic, reviewable source candidates.

    Discovery proposes endpoints only; it does not approve them. Invalid,
    non-HTTPS, and duplicate URLs are excluded with stable ordering.
    """
    candidates = {}
    for raw in results:
        result = classify_search_result(raw)
        if result.status not in {'SUCCEEDED', 'SOURCE MIGRATED'}:
            continue
        categories = sorted(set(result.categories_found))
        for url in result.urls:
            parsed = urlsplit(url)
            normalized = url.strip()
            if parsed.scheme != 'https' or not parsed.hostname or not normalized:
                continue
            key = normalized.rstrip('/')
            candidates.setdefault(key, {
                'provider': infer_provider(key, result.provider or provider),
                'url': key,
                'domains': categories,
                'discoveredFrom': result.query,
                'discoveryReason': result.reason or 'search result classified as successful',
            })
            candidates[key]['domains'] = sorted(set(candidates[key]['domains']) | set(categories))
    return [candidates[key] for key in sorted(candidates)]


def governed_source_proposals(results: Iterable[SearchResult], geography_id: str) -> list[dict]:
    """Create review-only registration proposals from search candidates."""
    proposals = []
    for candidate in candidate_source_configs(results):
        source_id = sha256(f"{geography_id}|{candidate['url']}".encode()).hexdigest()[:16]
        proposals.append({
            'id': f"discovered-{source_id}",
            'status': 'PROPOSED',
            'geographyId': geography_id,
            'sourceId': source_id,
            'provider': candidate['provider'],
            'url': candidate['url'],
            'domains': candidate['domains'],
            'binding': {'kind': 'region-source', 'regionId': geography_id, 'sourceId': source_id},
            'evidence': {
                'query': candidate['discoveredFrom'],
                'reason': candidate['discoveryReason'],
            },
            'publication': 'not authorized',
        })
    return proposals


def governed_config_from_candidate(candidate: dict, *, license_url: str,
                                   authority_tier: str) -> dict:
    """Promote one discovered candidate into an evidence-bearing config.

    Discovery remains proposal-only. Promotion is explicit and requires the
    two provenance fields consumed by the review gate.
    """
    if not license_url or not authority_tier or authority_tier.casefold() == 'unknown':
        raise ValueError('license_url and a known authority_tier are required')
    config = dict(candidate)
    config.update({'licenseUrl': license_url, 'authorityTier': authority_tier, 'status': 'APPROVED'})
    return config


class SourceSearchAdapter(Protocol):
    name: str

    def search(self, line: SearchLine) -> SearchResult: ...


def generate_search_lines(need: RegionalNeed, provider="deterministic-official-search") -> list[SearchLine]:
    lines: list[SearchLine] = []
    for requirement in need.requirements:
        category = requirement.canonical_category
        phrases = (
            f"{category} official data", f"{category} calendar", f"{category} map",
            f"{category} open data", f"{category} GIS", f"{category} API",
            f"{category} GeoJSON", f"{category} CSV", f"{category} ArcGIS",
            f"{category} FeatureServer", f"{category} MapServer",
            f"{category} iCal", f"{category} ICS",
        )
        for phrase in phrases:
            lines.append(SearchLine(
                need.geography_id, need.geography_query, category,
                requirement.frontend_surface,
                f'"{need.geography_query}" {phrase}', provider,
            ))
    return lines


def classify_search_result(result: SearchResult) -> SearchResult:
    """Normalize provider outcomes into the durable acquisition vocabulary."""
    status = result.status.strip().lower()
    aliases = {
        "ok": "SUCCEEDED", "success": "SUCCEEDED", "succeeded": "SUCCEEDED",
        "empty": "EMPTY", "no results": "EMPTY", "failed": "FAILED",
        "timeout": "TEMPORARY FAILURE", "429": "TEMPORARY FAILURE",
        "duplicate": "DUPLICATE SOURCE", "migrated": "SOURCE MIGRATED",
    }
    normalized = aliases.get(status, result.status.upper())
    return SearchResult(result.query, result.provider, normalized, tuple(sorted(set(result.urls))),
                        tuple(sorted(set(result.categories_found))), result.reason)


def search_feedback(result: SearchResult) -> dict:
    result = classify_search_result(result)
    domains = sorted({(urlsplit(url).hostname or "").lower().removeprefix("www.") for url in result.urls})
    return {
        "query": result.query, "provider": result.provider, "outcome": result.status,
        "source_urls": list(result.urls), "domains": domains,
        "categories_found": list(result.categories_found), "reason": result.reason,
    }
