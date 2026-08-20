"""Build free civic event cards from Boston's official public calendar."""

from __future__ import annotations

import html
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.request import Request, urlopen


SOURCE_URL = "https://www.boston.gov/events"
SOURCE_NAME = "City of Boston"
# This Windows Python installation has no IANA tzdata package. The current
# calendar window is Eastern daylight time; the source itself remains the
# authority for any later schedule changes.
EASTERN = timezone(timedelta(hours=-4))


def fetch_cards(now: datetime | None = None, max_pages: int = 17) -> list[dict[str, Any]]:
    """Fetch the official paginated calendar and keep only free upcoming cards."""
    current = (now or datetime.now(EASTERN)).astimezone(EASTERN)
    with ThreadPoolExecutor(max_workers=6) as pool:
        pages = list(pool.map(_fetch_page, range(max_pages)))
    cards: list[dict[str, Any]] = []
    for page_number, page in enumerate(pages):
        cards.extend(cards_from_html(page, current, page_number))
    # A listing can occur on more than one page; the City node is stable.
    return sorted({card["id"]: card for card in cards}.values(), key=lambda item: (item["date"], item["title"], item["id"]))


def cards_from_html(page: str, now: datetime, page_number: int = 0) -> list[dict[str, Any]]:
    """Convert saved calendar HTML into public cards without retaining raw payloads."""
    cards: list[dict[str, Any]] = []
    # Each City calendar date heading governs the article blocks until the next heading.
    sections = re.split(r'<h2[^>]*class=["\']listing-group-title["\'][^>]*>(.*?)</h2>', page, flags=re.S | re.I)
    for index in range(1, len(sections), 2):
        event_date = _date(_plain(sections[index]))
        if event_date is None or event_date < now.date() or event_date > (now.date() + timedelta(days=90)):
            continue
        for article in re.findall(r'<article\s+id=["\']node-(\d+)["\'][^>]*class=["\'][^"\']*calendar-listing-wrapper[^"\']*["\'][^>]*>(.*?)</article>', sections[index + 1], flags=re.S | re.I):
            node_id, markup = article
            if not re.search(r'<div class=["\']dl-t["\']>\s*Price:\s*</div>\s*<div[^>]*dl-d[^>]*>\s*FREE\s*</div>', markup, flags=re.S | re.I):
                continue
            title = _field(markup, r'<div class=["\']title["\']>\s*(.*?)\s*</div>')
            if not title:
                continue
            starts_at, ends_at = _times(event_date, _field(markup, r'<span class=["\']time-range["\']>\s*(.*?)\s*</span>'))
            if starts_at and starts_at < now:
                continue
            address = _address(markup)
            description = _field(markup, r'<div class=["\']description["\']>\s*(.*?)\s*</div>')
            source_url = f"{SOURCE_URL}?page={page_number}"
            cards.append({
                "id": f"boston:{node_id}:{event_date.isoformat()}",
                "title": title,
                "date": event_date.isoformat(),
                "startsAt": starts_at.isoformat() if starts_at else None,
                "endsAt": ends_at.isoformat() if ends_at else None,
                "locationLabel": address or "Boston — see official calendar",
                "venueAddress": address or None,
                "summary": description[:360] or "A free event listed by the City of Boston.",
                "officialUrl": source_url,
                "expiresAt": (ends_at or starts_at or datetime.combine(event_date, datetime.max.time(), EASTERN)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "source": {"name": SOURCE_NAME, "url": source_url, "authorityTier": "local_government", "reviewStatus": "verified"},
            })
    return cards


def _fetch_page(page: int) -> str:
    with urlopen(Request(f"{SOURCE_URL}?page={page}", headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=45) as response:
        return response.read().decode("utf-8", "replace")


def _date(value: str):
    try:
        return datetime.strptime(value, "%B %d, %Y").date()
    except ValueError:
        return None


def _times(date_value, raw: str):
    match = re.search(r"(\d{1,2}:\d{2}(?:am|pm))(?:\s*-\s*(\d{1,2}:\d{2}(?:am|pm)))?", raw.casefold())
    if not match:
        return None, None
    start = datetime.strptime(f"{date_value} {match.group(1)}", "%Y-%m-%d %I:%M%p").replace(tzinfo=EASTERN)
    end = datetime.strptime(f"{date_value} {match.group(2)}", "%Y-%m-%d %I:%M%p").replace(tzinfo=EASTERN) if match.group(2) else None
    return start, end


def _address(markup: str) -> str:
    field = _field(markup, r'<div[^>]*itemprop=["\']streetAddress["\'][^>]*>(.*?)</div>')
    locality = _field(markup, r'<span[^>]*class=["\']locality["\'][^>]*>(.*?)</span>')
    postal = _field(markup, r'<span[^>]*class=["\']postal-code["\'][^>]*>(.*?)</span>')
    parts = [part for part in (field, locality, "MA", postal) if part]
    return ", ".join(parts)


def _field(markup: str, pattern: str) -> str:
    match = re.search(pattern, markup, flags=re.S | re.I)
    return _plain(match.group(1)) if match else ""


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()
