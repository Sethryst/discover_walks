"""Create public-meeting cards from Fairfax County's official RSS calendar."""

from __future__ import annotations

import hashlib
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Callable
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SOURCE_URL = "https://www.fairfaxcounty.gov/calendar/RssFeed.aspx?cal=1"
SOURCE_NAME = "Fairfax County, Virginia"
LOCAL_TIME = ZoneInfo("America/New_York")


def fetch_cards(now: datetime | None = None) -> list[dict]:
    current = now or datetime.now(timezone.utc)
    with urlopen(Request(SOURCE_URL, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=45) as response:
        feed = response.read()
    return cards_from_feed(feed, current, _fetch_detail)


def cards_from_feed(feed: bytes | str, now: datetime, detail_loader: Callable[[str], str | None]) -> list[dict]:
    """Use event detail pages for date/time/location; RSS itself omits dates."""
    root = ET.fromstring(feed)
    cards = []
    for item in root.findall(".//item"):
        title = _text(item.find("title"))
        url = _text(item.find("link")).replace("http://", "https://", 1)
        if not title or not url.startswith("https://www.fairfaxcounty.gov/"):
            continue
        detail = detail_loader(url)
        parsed = _detail(detail or "")
        if not parsed:
            continue
        start, location, summary = parsed
        if start.date() < now.date() or start.date() > now.date() + timedelta(days=90):
            continue
        cards.append({
            "id": f"fairfax-county-va:{hashlib.sha256(url.encode()).hexdigest()[:16]}:{start.date().isoformat()}",
            "title": title,
            "date": start.date().isoformat(),
            "startsAt": start.isoformat(),
            "endsAt": start.isoformat(),
            "locationLabel": location or None,
            "venueAddress": location or None,
            "summary": summary or "A public meeting listed by Fairfax County.",
            "officialUrl": url,
            "expiresAt": (start.astimezone(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
            "source": {"name": SOURCE_NAME, "url": url, "authorityTier": "county_government", "reviewStatus": "verified"},
        })
    return sorted({card["id"]: card for card in cards}.values(), key=lambda card: (card["date"], card["title"]))


def _fetch_detail(url: str) -> str | None:
    try:
        with urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=45) as response:
            return response.read().decode("utf-8", "replace")
    except OSError:
        return None


def _detail(page: str) -> tuple[datetime, str, str] | None:
    date = _field(page, "Event Date")
    time = _field(page, "Time")
    if not date or not time:
        return None
    try:
        start = datetime.strptime(f"{date} {time}", "%A, %B %d, %Y %I:%M %p").replace(tzinfo=LOCAL_TIME)
    except ValueError:
        return None
    location = _field(page, "Location")
    description = _plain(_field(page, "Description") or "")
    return start, _plain(location), description


def _field(page: str, label: str) -> str:
    pattern = rf"<b>\s*{re.escape(label)}\s*</b>\s*:\s*</td>\s*<td[^>]*>(.*?)</td>"
    match = re.search(pattern, page, re.I | re.S)
    return match.group(1).strip() if match else ""


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value.replace("<br/>", " ").replace("<br>", " ")))).strip()


def _text(node: ET.Element | None) -> str:
    return (node.text or "").strip() if node is not None else ""
