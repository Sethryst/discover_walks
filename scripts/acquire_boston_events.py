"""Acquire dated, location-backed events from the City of Boston calendar."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://www.boston.gov/events"
OUT = Path("motherbird/regions/boston/civic/index.json")


def acquire() -> list[dict]:
    now = datetime.now(timezone.utc)
    items: list[dict] = []
    seen: set[str] = set()
    for page in range(20):
        url = BASE if page == 0 else f"{BASE}?page={page}"
        soup = BeautifulSoup(requests.get(url, timeout=30).text, "html.parser")
        groups = soup.select("div.p-b700")
        if not groups:
            break
        found_future = False
        for group in groups:
            heading = group.select_one("h2.listing-group-title")
            if not heading:
                continue
            try:
                day = datetime.strptime(heading.get_text(" ", strip=True), "%B %d, %Y").date()
            except ValueError:
                continue
            if day >= now.date():
                found_future = True
            for article in group.select("article.calendar-listing-wrapper"):
                node = article.get("id", "")
                if not node or node in seen or day < now.date():
                    continue
                seen.add(node)
                title = article.select_one(".title")
                addr = article.select_one("[itemprop='streetAddress']")
                locality = article.select_one("[itemprop='addressLocality']")
                region = article.select_one("[itemprop='addressRegion']")
                detail = article.select_one("a[title*='details']")
                if not (title and addr and locality and detail):
                    continue
                address = " ".join(addr.stripped_strings)
                city = locality.get_text(" ", strip=True)
                state = region.get_text(" ", strip=True) if region else ""
                if not address or address.upper() in {"VIRTUAL", "ONLINE"}:
                    continue
                location = ", ".join(x for x in (address, city, state) if x)
                source_url = requests.compat.urljoin(BASE, detail.get("href"))
                item_id = f"boston:{node}:{day.isoformat()}"
                items.append({
                    "date": day.isoformat(),
                    "id": item_id,
                    "locationLabel": location,
                    "officialUrl": source_url,
                    "source": {
                        "authorityTier": "local_government",
                        "name": "City of Boston",
                        "reviewStatus": "verified",
                        "url": BASE,
                    },
                    "summary": "Official City of Boston calendar listing.",
                    "title": title.get_text(" ", strip=True),
                    "venueAddress": location,
                })
        if not found_future:
            break
    return items


def main() -> None:
    payload = json.loads(OUT.read_text(encoding="utf-8"))
    current = payload["artifacts"].setdefault("events", {"items": []})
    fresh = acquire()
    by_id = {x["id"]: x for x in current.get("items", [])}
    by_id.update({x["id"]: x for x in fresh})
    current["items"] = sorted(by_id.values(), key=lambda x: (x.get("date", ""), x["id"]))
    current["generatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload["generatedAt"] = current["generatedAt"]
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"new": len(fresh), "total": len(current["items"])}, indent=2))


if __name__ == "__main__":
    main()
