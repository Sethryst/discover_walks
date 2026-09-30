"""Deterministic identities for feeds that omit a usable event identifier."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from urllib.parse import urlsplit, urlunsplit


def fallback_event_id(canonical_url: str, title: str, date: str, location: str = "") -> str:
    """Return a reproducible ID from canonical URL plus normalized event facts."""
    parts = "|".join(_normalize(value) for value in (canonical_event_url(canonical_url), title, date, location))
    return "event-fallback-" + hashlib.sha256(parts.encode("utf-8")).hexdigest()[:24]


def canonical_event_url(url: str) -> str:
    split = urlsplit(str(url).strip())
    return urlunsplit((split.scheme.lower(), split.netloc.lower(), re.sub(r"/+$", "", split.path) or "/", split.query, ""))


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value or "")).strip().casefold())
