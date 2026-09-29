"""Acquire Boulder, Colorado's official server-rendered events calendar."""
from __future__ import annotations
import json, re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
URL = "https://bouldercolorado.gov/events"

def main() -> None:
    soup = BeautifulSoup(requests.get(URL, timeout=30).text, "html.parser")
    now = datetime.now(timezone.utc)
    records = []
    for article in soup.select("article"):
        fields = list(article.stripped_strings)
        link = article.find("a", href=True)
        if len(fields) < 5 or not link:
            continue
        date_match = re.search(r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})\b", " ".join(fields))
        if not date_match or "Canceled" in fields:
            continue
        date_value = datetime.strptime(f"{date_match.group(2)} {date_match.group(3)} {date_match.group(4)}", "%b %d %Y").replace(tzinfo=timezone.utc)
        if date_value < now:
            continue
        location = next((value for value in fields[1:] if value in {"Virtual", "Penfield Tate II Municipal Building"} or "Boulder" in value), None)
        if not location:
            continue
        records.append({"id": urljoin(URL, link["href"]), "title": fields[0], "date": date_value.date().isoformat(), "location": location, "url": urljoin(URL, link["href"])})
    path = ROOT / "motherbird/regions/boulder/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    events = payload.setdefault("artifacts", {}).setdefault("events", {"schemaVersion": 1, "regionId": "boulder", "producer": "boulder-events-static", "generatedAt": stamp, "items": []})
    meetings = payload["artifacts"].setdefault("meetings", {"schemaVersion": 1, "regionId": "boulder", "producer": "boulder-events-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in events["items"]}
    added = 0
    for record in records:
        event_id = f"boulder:city-events:{record['id']}"
        if event_id in existing:
            continue
        starts = record["date"] + "T00:00:00Z"
        item = {"id": event_id, "title": record["title"], "date": record["date"], "startsAt": starts, "endsAt": starts, "locationLabel": record["location"], "venueAddress": record["location"], "summary": "A public event listed by the City of Boulder.", "officialUrl": record["url"], "expiresAt": starts, "source": {"name": "City of Boulder Events", "url": URL, "authorityTier": "city_government", "reviewStatus": "verified"}}
        events["items"].append(item)
        meetings["items"].append(item)
        added += 1
    events["generatedAt"] = meetings["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"candidateRecords": len(records), "publishedEvents": added, "publishedMeetings": added}))

if __name__ == "__main__": main()
