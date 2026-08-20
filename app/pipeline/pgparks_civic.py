"""Build address-rich civic event cards from the official PG Parks calendar."""

from __future__ import annotations

import html
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen


SOURCE_URL = "https://www.pgparks.com/wp-json/tribe/events/v1/events"
SOURCE_NAME = "M-NCPPC Department of Parks and Recreation, Prince George's County"


def fetch_cards(now: datetime | None = None, limit: int = 250, max_pages: int = 5) -> list[dict[str, Any]]:
    """Fetch current free events and enrich them from their own official pages."""
    current = now or datetime.now(timezone.utc)
    payload = _fetch_all_pages(current, max_pages)
    return cards_from_payload(payload, current, _fetch_details, limit)


def _fetch_all_pages(now: datetime, max_pages: int) -> dict[str, Any]:
    """Follow the provider's own pagination; one page is not regional coverage."""
    # Limit extraction to the upcoming 90-day window; older calendar history is
    # not a current civic opportunity and must not consume the refresh budget.
    start = now.date().isoformat()
    end = (now + timedelta(days=90)).date().isoformat()
    url = f"{SOURCE_URL}?per_page=100&start_date={start}&end_date={end}"
    events: list[dict[str, Any]] = []
    for _ in range(max_pages):
        request = Request(url, headers={"Accept": "application/json", "User-Agent": "Gremlin-Lab/1.0"})
        with urlopen(request, timeout=60) as response:
            page = json.loads(response.read().decode("utf-8"))
        events.extend(page.get("events", []))
        url = str(page.get("next_rest_url") or "")
        if not url.startswith("https://"):
            break
    return {"events": events}


def cards_from_payload(payload: dict[str, Any], now: datetime, detail_loader: Callable[[str], dict[str, Any] | None], limit: int = 25) -> list[dict[str, Any]]:
    """Convert free, non-expired feed events to public cards; no personal data is copied."""
    cards: list[dict[str, Any]] = []
    eligible = []
    for event in payload.get("events", []):
        if not _is_free(event):
            continue
        start = _parse(event.get("start_date"))
        end = _parse(event.get("end_date")) or start
        if not start or end.date() < now.date():
            continue
        eligible.append((event, start, end))
    details = {url: detail for url, detail in detail_loader([str(event.get("url", "")) for event, _, _ in eligible[:limit]]).items()} if detail_loader is _fetch_details else {}
    for event, start, end in eligible:
        detail = details.get(str(event.get("url", ""))) or (detail_loader(str(event.get("url", ""))) if not details else None) or {}
        location = detail.get("location", {})
        venue = str(location.get("name") or "").strip()
        address = _address(location.get("address"))
        title = html.unescape(str(event.get("title", "")).strip())
        if not title:
            continue
        location_label = venue or address or _named_place(title) or "Prince George's County — see official event page"
        description = _plain(detail.get("description") or event.get("description") or "")
        cards.append({
            "id": f"pgparks:{event['id']}:{start.date().isoformat()}",
            "title": title,
            "date": start.date().isoformat(),
            "startsAt": start.isoformat(),
            "endsAt": end.isoformat(),
            "locationLabel": location_label,
            "venueAddress": address or None,
            "summary": description[:360] or "A free event listed by Prince George's County Parks and Recreation.",
            "officialUrl": event["url"],
            "expiresAt": (end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")),
            "source": {"name": SOURCE_NAME, "url": event["url"], "authorityTier": "local_government", "reviewStatus": "verified"},
        })
        if len(cards) >= limit:
            break
    return cards


def _fetch_details(urls: list[str]) -> dict[str, dict[str, Any] | None]:
    """Bound concurrent detail requests; source pages remain the authority for venue data."""
    with ThreadPoolExecutor(max_workers=6) as pool:
        return dict(zip(urls, pool.map(_fetch_detail, urls)))


def _fetch_detail(url: str) -> dict[str, Any] | None:
    if not url.startswith("https://"):
        return None
    try:
        with urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=30) as response:
            page = response.read().decode("utf-8", "replace")
        for raw in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, flags=re.S | re.I):
            parsed = json.loads(html.unescape(raw.strip()))
            for item in _jsonld_items(parsed):
                if item.get("@type") == "Event":
                    return item
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return None


def _jsonld_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [item for item in value.get("@graph", [value]) if isinstance(item, dict)]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _is_free(event: dict[str, Any]) -> bool:
    if str(event.get("cost", "")).strip().casefold() == "free":
        return True
    return any(str(category.get("name", "")).strip().casefold() == "free" for category in event.get("categories", []))


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _address(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return ", ".join(str(value[key]).strip() for key in ("streetAddress", "addressLocality", "addressRegion", "postalCode") if value.get(key))
    return ""


def _plain(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(value)))).strip()


def _named_place(title: str) -> str:
    """Use an explicit venue suffix from the official title, never infer an address."""
    match = re.search(r"\s@\s(.+)$", title)
    return match.group(1).strip() if match else ""
