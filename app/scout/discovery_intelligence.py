"""Review-only memory and ranking helpers for source discovery.

This module deliberately stops at research recommendations.  It never activates
an endpoint or writes app/runtime data.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit


def canonical_url(url: str) -> str:
    split = urlsplit(str(url).strip())
    path = split.path.rstrip("/") or "/"
    return urlunsplit((split.scheme.lower(), split.netloc.lower(), path, split.query, ""))


def source_key(url: str, category: str = "") -> str:
    value = f"{category}|{canonical_url(url)}"
    return "source-observation-" + hashlib.sha256(value.encode()).hexdigest()[:16]


def observation_from_candidate(candidate: dict[str, Any], *, outcome: str = "discovered", observed_at: str | None = None, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    """Convert a backlog candidate into an append-friendly source observation."""
    url = canonical_url(candidate["url"])
    discovery = candidate.get("discovery", {})
    return {
        "id": source_key(url, candidate.get("category", "")),
        "url": url,
        "regionId": candidate.get("regionId") or candidate.get("region", {}).get("id"),
        "category": candidate.get("category", "unknown"),
        "publisher": candidate.get("publisher", "Unknown publisher"),
        "providerFamily": candidate.get("provider") or candidate.get("dataType", "unknown"),
        "discovery": {"origin": discovery.get("origin"), "method": discovery.get("method"), "foundAt": discovery.get("foundAt"), "confidence": discovery.get("confidence")},
        "authority": candidate.get("authority", "unknown"),
        "outcome": outcome,
        "probe": probe or {},
        "failureClass": (probe or {}).get("failureClass"),
        "observedAt": observed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nextReviewAt": candidate.get("nextReviewAt"),
        "publication": {"state": "research-only", "published": False},
    }


def merge_observations(observations: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the latest observation per canonical source/category while preserving counts."""
    merged: dict[str, dict[str, Any]] = {}
    for raw in observations:
        url = canonical_url(raw.get("url", ""))
        key = source_key(url, raw.get("category", ""))
        row = dict(raw, id=key, url=url)
        prior = merged.get(key)
        if prior is None or str(row.get("observedAt", "")) >= str(prior.get("observedAt", "")):
            history = list(prior.get("history", [])) if prior else []
            if prior:
                history.append({"observedAt": prior.get("observedAt"), "outcome": prior.get("outcome"), "probe": prior.get("probe", {})})
            row["observationCount"] = int(prior.get("observationCount", 0)) + 1 if prior else 1
            row["history"] = history[-20:]
            merged[key] = row
    return [merged[key] for key in sorted(merged)]


def rank_next_investigations(candidates: Iterable[dict[str, Any]], *, missing_categories: set[str] = set(), observations: Iterable[dict[str, Any]] = ()) -> list[dict[str, Any]]:
    """Rank research candidates with transparent, bounded scoring."""
    history = list(observations)
    provider_outcomes: dict[str, list[str]] = {}
    for item in history:
        provider_outcomes.setdefault(item.get("providerFamily", "unknown"), []).append(item.get("outcome", "unknown"))
    ranked = []
    for candidate in candidates:
        authority = {"government": 5, "public_institution": 4, "official_partner": 3, "editorial": 2}.get(candidate.get("authority"), 1)
        impact = {"high": 5, "medium": 3, "low": 1}.get(candidate.get("coverageValue"), 1)
        structure = 5 if candidate.get("dataType") in {"JSON API", "ArcGIS", "Socrata", "CKAN", "RSS/ICS", "GeoJSON"} else 2
        difficulty = 1 if candidate.get("dataType") in {"JSON API", "RSS/ICS", "GeoJSON"} else 2 if structure == 5 else 3
        gap = 2 if candidate.get("category") in missing_categories else 0.75
        provider = candidate.get("provider") or candidate.get("dataType", "unknown")
        outcomes = provider_outcomes.get(provider, [])
        success = sum(value in {"validated", "published", "succeeded"} for value in outcomes)
        reuse = min(5, 1 + success)
        information_gain = 5 if not outcomes else max(1, 5 - len(outcomes) + success)
        confidence = float(candidate.get("discovery", {}).get("confidence", 0.5))
        raw_score = (authority * 0.25 + impact * 0.2 + structure * 0.15 + reuse * 0.15 + information_gain * 0.15 + confidence * 5 * 0.1) * gap / difficulty
        ranked.append({**candidate, "recommendation": {"score": round(raw_score, 3), "components": {"coverageGap": gap, "authority": authority, "structure": structure, "providerReuse": reuse, "informationGain": information_gain, "difficulty": difficulty, "confidence": round(confidence, 3)}, "reason": "Ranked for coverage impact, source authority, structured-data likelihood, provider reuse, implementation effort, and information gain.", "publicationState": "research-only"}})
    ranked.sort(key=lambda item: (-item["recommendation"]["score"], item.get("category", ""), item.get("url", "")))
    for index, item in enumerate(ranked, 1):
        item["recommendation"]["rank"] = index
    return ranked
