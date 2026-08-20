"""Normalize City of Alexandria's official public-meetings RSS feed."""

from __future__ import annotations

import hashlib
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SOURCE_URL = "https://apps.alexandriava.gov/Calendar/RSS.aspx?df=list&show=PublicMeetings"
SOURCE_NAME = "City of Alexandria, Virginia"
LOCAL_TIME = ZoneInfo("America/New_York")


def fetch_cards(now: datetime | None = None) -> list[dict]:
    current = now or datetime.now(timezone.utc)
    with urlopen(Request(SOURCE_URL, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=45) as response:
        return cards_from_feed(response.read(), current)


def cards_from_feed(feed: bytes | str, now: datetime) -> list[dict]:
    root = ET.fromstring(feed)
    cards = []
    for item in root.findall(".//item"):
        raw_title, url, description = (_text(item.find("title")), _text(item.find("link")), _text(item.find("description")))
        parsed = _title_time(raw_title)
        if not parsed or not url.startswith("https://apps.alexandriava.gov/") or "CityPoolHours" in description:
            continue
        title, start = parsed
        if start.date() < now.date() or start.date() > now.date() + timedelta(days=90):
            continue
        location = _field(description, "Location") or _plain(description).split(" Contact Person:")[0].strip()
        summary = _plain(description)
        cards.append({
            "id": f"alexandria-va:{hashlib.sha256(url.encode()).hexdigest()[:16]}:{start.date().isoformat()}",
            "title": title,
            "date": start.date().isoformat(),
            "startsAt": start.isoformat(),
            "endsAt": start.isoformat(),
            "locationLabel": location or "Alexandria — see official event page",
            "venueAddress": location or None,
            "summary": summary[:360] or "A public meeting listed by the City of Alexandria.",
            "officialUrl": url,
            "expiresAt": (start.astimezone(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
            "source": {"name": SOURCE_NAME, "url": url, "authorityTier": "city_government", "reviewStatus": "verified"},
        })
    return sorted({card["id"]: card for card in cards}.values(), key=lambda card: (card["date"], card["title"]))


def _title_time(value: str) -> tuple[str, datetime] | None:
    match = re.match(r"^(.*?)\s+-\s+\w{3}\s+(\w{3}\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2})", value)
    if not match:
        return None
    try:
        return match.group(1).strip(), datetime.strptime(f"{match.group(2)} {match.group(3)}", "%b %d, %Y %H:%M").replace(tzinfo=LOCAL_TIME)
    except ValueError:
        return None


def _field(value: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}:\s*(.*?)(?:<br\s*/?>|$)", value, re.I | re.S)
    return _plain(match.group(1)) if match else ""


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def _text(node: ET.Element | None) -> str:
    return (node.text or "").strip() if node is not None else ""
