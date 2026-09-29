"""Acquire future NYC Council meetings from the official Legistar calendar."""
from __future__ import annotations
import json, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "meetings-legistar-council-nyc-gov-e75d3835"
URL = "https://legistar.council.nyc.gov/Calendar.aspx"

def main() -> None:
    html = requests.get(URL, timeout=30, headers={"User-Agent": "Gremlin-Lab/1.0"}).text
    soup = BeautifulSoup(html, "html.parser")
    now = datetime.now(timezone.utc)
    records = []
    for row in soup.select("tr"):
        link = row.find("a", href=lambda value: value and "View.ashx" in value)
        fields = list(row.stripped_strings)
        if not link or len(fields) < 4:
            continue
        match = next((candidate for value in fields if (candidate := re.search(r"\b\d{1,2}/\d{1,2}/\d{4}\b", value))), None)
        if not match:
            continue
        date_value = datetime.strptime(match.group(), "%m/%d/%Y").replace(tzinfo=timezone.utc)
        if date_value < now:
            continue
        time_value = next((value for value in fields if re.fullmatch(r"\d{1,2}:\d{2} [AP]M", value)), "")
        location = next((value for value in fields if "city hall" in value.lower() or "chambers" in value.lower() or "room" in value.lower()), "")
        if not location:
            continue
        records.append({"id": link["href"], "title": fields[0], "date": date_value.date().isoformat(), "time": time_value, "location": location, "url": urljoin(URL, link["href"])})
    path = ROOT / "motherbird/regions/new-york-city/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    artifact = payload.setdefault("artifacts", {}).setdefault("meetings", {"schemaVersion": 1, "regionId": "new-york-city", "producer": "legistar-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in artifact["items"]}
    added = 0
    for record in records:
        event_id = f"nyc:legistar:{record['id']}"
        if event_id in existing:
            continue
        starts = f"{record['date']}T00:00:00Z"
        artifact["items"].append({"id": event_id, "title": record["title"], "date": record["date"], "startsAt": starts, "endsAt": starts, "locationLabel": record["location"], "venueAddress": record["location"], "summary": "A public meeting listed by the New York City Council.", "officialUrl": record["url"], "expiresAt": starts, "source": {"name": "New York City Council Legistar", "url": URL, "authorityTier": "city_government", "reviewStatus": "verified"}})
        added += 1
    artifact["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "candidateRecords": len(records), "published": added}))

if __name__ == "__main__":
    main()
