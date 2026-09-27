"""Deterministic source-search contracts for package acquisition.

Network providers implement ``search``; this module owns query generation and
result classification so search behavior is replayable and auditable.
"""
from __future__ import annotations

from dataclasses import dataclass
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
