"""Use NYC Parks' public aggregate event endpoint when the RSS URL is blocked."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "events-nycgovparks-org-61d38c99"
BASE = "https://www.nycgovparks.org"
ENDPOINTS = [f"{BASE}/events/education/ajax/aggregate/inftrees/p{i}" for i in range(1, 7)]

def main() -> None:
    records = {}
    for endpoint in ENDPOINTS:
        with urlopen(Request(endpoint, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=30) as response:
            soup = BeautifulSoup(response.read(), "html.parser")
        for body in soup.select(".event_body"):
            title = body.select_one("h3.event-title a")
            start = body.select_one("meta[itemprop=startDate]")
            if not title or not start or not start.get("content"):
                continue
            location = body.select_one("h4.location")
            url = urljoin(BASE, title.get("href", ""))
            records[url] = {
                "title": title.get_text(" ", strip=True),
                "startsAt": start["content"],
                "endsAt": (body.select_one("meta[itemprop=endDate]") or {}).get("content"),
                "location": location.get_text(" ", strip=True).removeprefix("at ") if location else "New York City",
                "url": url,
            }
    path = ROOT / "motherbird/regions/new-york-city/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload["artifacts"]["events"]["items"]
    existing = {item["id"] for item in items}
    now = datetime.now(timezone.utc)
    added = 0
    for record in records.values():
        start = datetime.fromisoformat(record["startsAt"])
        if start.astimezone(timezone.utc) < now:
            continue
        event_id = f"backlog:{SOURCE_ID}:{record['url']}"
        if event_id in existing:
            continue
        date = start.date().isoformat()
        items.append({"id": event_id, "title": record["title"], "date": date, "startsAt": record["startsAt"], "endsAt": record["endsAt"], "locationLabel": record["location"], "summary": "Free event listed by NYC Parks.", "officialUrl": record["url"], "expiresAt": f"{date}T23:59:59-05:00", "source": {"name": "NYC Parks Events", "url": record["url"], "reviewStatus": "adapter-captured"}})
        added += 1
    payload["artifacts"]["events"]["items"] = items
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"discovered": len(records), "added": added}))

if __name__ == "__main__": main()
