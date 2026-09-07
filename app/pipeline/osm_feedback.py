"""Deterministic aggregation of map feedback into bounded engineering prompts."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Iterable


def _redact(value: str) -> str:
    value = re.sub(r"https?://\S+", "[url]", value)
    value = re.sub(r"\b[\w.+-]+@[\w.-]+\.\w+\b", "[email]", value)
    return " ".join(value.split())[:280]


def build_prompt(events: Iterable[dict[str, Any]], *, release: str, selectors: str, metrics: str) -> str | None:
    """Return a reviewable prompt only for a corroborated feedback cluster."""
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        key = (str(event.get("state", "unknown")), str(event.get("h3", "unknown")), str(event.get("filterId", "unknown")))
        groups[key].append(event)
    candidates = [(key, items) for key, items in groups.items() if len(items) >= 3]
    if not candidates:
        return None
    (state, h3, filter_id), items = max(candidates, key=lambda pair: len(pair[1]))
    actions = Counter(str(item.get("action", "unknown")) for item in items)
    reports = [_redact(str(item.get("text", ""))) for item in items if str(item.get("text", "")).strip()][:5]
    problem = " ".join(reports) or "Repeated feedback requires investigation."
    return f"""You are improving the Gremlin offline/online map release {release}.\n\nEvidence:\n- State/equivalent: {state}\n- H3 cell: {h3}\n- Filter: {filter_id}\n- Feedback counts: {dict(actions)}\n- Representative reports: {reports}\n- Current extraction selectors: {selectors}\n- Current PMTiles metrics: {metrics}\n\nTask:\nInvestigate this corroborated report: {problem}\nChoose exactly one change class: extraction | normalization | tiling/indexing | UI.\nDo not broaden the OSM allowlist without evidence. Preserve ODbL attribution, release checksums, deterministic ordering, and offline behavior.\n\nAcceptance criteria:\n1. Add a regression test for the reported behavior.\n2. Record the changed selector/schema/tool version in the release manifest.\n3. Existing Fairfax/regression tests remain green.\n4. State whether human review is required before the next national build.\n"""
