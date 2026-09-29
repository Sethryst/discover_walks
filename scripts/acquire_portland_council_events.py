"""Acquire Portland City Council's official upcoming meeting pages."""
from __future__ import annotations
import json, re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "meetings-portland-gov-a7c4178f"
LIST_URL = "https://www.portland.gov/auditor/council-clerk/city-hall/events"

def main() -> None:
    soup = BeautifulSoup(requests.get(LIST_URL, timeout=30).text, "html.parser")
    now = datetime.now(timezone.utc)
    records = []
    for row in soup.select(".views-row"):
        time_node = row.select_one("time.datetime[datetime]")
        link = row.select_one("a[href*='/events/']")
        if not time_node or not link:
            continue
        date_value = datetime.fromisoformat(time_node["datetime"]).replace(tzinfo=timezone.utc)
        if date_value < now:
            continue
        detail_url = urljoin(LIST_URL, link["href"])
        detail = BeautifulSoup(requests.get(detail_url, timeout=30).text, "html.parser")
        location_text = " ".join(detail.stripped_strings)
        marker = re.search(r"Location\s+(.*?)(?:Get directions|More about this location)", location_text, re.I | re.S)
        if not marker:
            continue
        location = re.sub(r"\s+", " ", marker.group(1)).strip()
        records.append({"id": detail_url, "title": link.get_text(" ", strip=True), "date": date_value.date().isoformat(), "location": location, "url": detail_url})
    path = ROOT / "motherbird/regions/portland/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    artifact = payload.setdefault("artifacts", {}).setdefault("meetings", {"schemaVersion": 1, "regionId": "portland", "producer": "portland-council-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in artifact["items"]}
    added = 0
    for record in records:
        event_id = f"portland:council:{record['id']}"
        if event_id in existing:
            continue
        starts = record["date"] + "T00:00:00Z"
        artifact["items"].append({"id": event_id, "title": record["title"], "date": record["date"], "startsAt": starts, "endsAt": starts, "locationLabel": record["location"], "venueAddress": record["location"], "summary": "A public meeting listed by the City of Portland.", "officialUrl": record["url"], "expiresAt": starts, "source": {"name": "City of Portland Council Calendar", "url": LIST_URL, "authorityTier": "city_government", "reviewStatus": "verified"}})
        added += 1
    artifact["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "candidateRecords": len(records), "published": added}))

if __name__ == "__main__": main()
