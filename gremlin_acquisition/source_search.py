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
                'provider': result.provider or provider,
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


class SourceSearchAdapter(Protocol):
    name: str

    def search(self, line: SearchLine) -> SearchResult: ...


def generate_search_lines(need: RegionalNeed, provider="deterministic-official-search") -> list[SearchLine]:
    lines: list[SearchLine] = []
    for requirement in need.requirements:
        category = requirement.canonical_category
        phrases = (f"{category} official data", f"{category} calendar", f"{category} map")
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
