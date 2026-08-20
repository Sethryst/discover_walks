"""Build civic event cards from Philadelphia's official permitted-events calendar."""

from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen


SOURCE_URL = "https://www.phila.gov/departments/office-of-special-events/events/special-events-calendar/"
SOURCE_NAME = "Philadelphia Office of Special Events"


def fetch_cards(now: datetime | None = None) -> list[dict]:
    current = now or datetime.now(timezone.utc)
    with urlopen(Request(SOURCE_URL, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=45) as response:
        return cards_from_html(response.read().decode("utf-8", "replace"), current)


def cards_from_html(page: str, now: datetime) -> list[dict]:
    """Keep public schedule fields; do not infer admission cost or coordinates."""
    cards = []
    for block in re.findall(r'<li class=["\']simcal-event\b.*?</li>', page, flags=re.S | re.I):
        event_id = _value(r'data-open=["\']([^"\']+)', block)
        title = _value(r'simcal-event-title["\'][^>]*itemprop=["\']name["\']>(.*?)</span>', block)
        start = _value(r'itemprop=["\']startDate["\'] content=["\']([^"\']+)', block)
        end = _value(r'itemprop=["\']endDate["\'] content=["\']([^"\']+)', block) or start
        address = _value(r'itemprop=["\']address["\'] content=["\']([^"\']+)', block)
        if not all((event_id, title, start, address)):
            continue
        try:
            starts = datetime.fromisoformat(start)
            ends = datetime.fromisoformat(end)
        except ValueError:
            continue
        if starts.date() < now.date() or starts.date() > (now.date() + timedelta(days=90)):
            continue
        cards.append({
            "id": f"phila-special-events:{event_id}:{starts.date().isoformat()}",
            "title": _plain(title), "date": starts.date().isoformat(),
            "startsAt": starts.isoformat(), "endsAt": ends.isoformat(),
            "locationLabel": _plain(address), "venueAddress": _plain(address),
            "summary": "An official Philadelphia permitted special event. Check the source for current admission, accessibility, and schedule details.",
            "officialUrl": SOURCE_URL,
            "expiresAt": ends.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": {"name": SOURCE_NAME, "url": SOURCE_URL, "authorityTier": "local_government", "reviewStatus": "verified"},
        })
    return sorted({item["id"]: item for item in cards}.values(), key=lambda item: (item["date"], item["title"]))


def _value(pattern: str, value: str) -> str:
    match = re.search(pattern, value, flags=re.S | re.I)
    return match.group(1) if match else ""


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()
