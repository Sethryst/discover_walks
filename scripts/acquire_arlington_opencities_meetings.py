"""Acquire Arlington County's server-rendered OpenCities meeting list."""
from __future__ import annotations
import json, re
from datetime import datetime, timezone
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
URL = "https://www.arlingtonva.us/Government/Topics/Meeting-Calendar"
EVENT_SOURCE = "events-arlingtonva-us-cb15b262"
MEETING_SOURCE = "meetings-arlingtonva-us-cb15b262"

def main() -> None:
    soup = BeautifulSoup(requests.get(URL, timeout=30).text, "html.parser")
    now = datetime.now(timezone.utc)
    records = []
    for article in soup.select("article"):
        fields = list(article.stripped_strings)
        if len(fields) < 6:
            continue
        date_match = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b", " ".join(fields))
        if not date_match:
            continue
        date_value = datetime.strptime(date_match.group(), "%d %b %Y").replace(tzinfo=timezone.utc)
        if date_value < now:
            continue
        location = next((value for value in fields[4:] if "Arlington" in value or "Government Center" in value), None)
        if not location:
            continue
        link = article.find("a", href=True)
        records.append({"id": link["href"] if link else fields[0], "title": fields[0], "date": date_value.date().isoformat(), "location": location, "url": link["href"] if link else URL})
    path = ROOT / "motherbird/regions/arlington-va/civic/index.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = now.isoformat().replace("+00:00", "Z")
    payload = {"schemaVersion": 1, "regionId": "arlington-va", "generatedAt": stamp, "artifacts": {"events": {"schemaVersion": 1, "regionId": "arlington-va", "producer": "opencities-static", "generatedAt": stamp, "items": []}, "meetings": {"schemaVersion": 1, "regionId": "arlington-va", "producer": "opencities-static", "generatedAt": stamp, "items": []}}}
    for record in records:
        starts = f"{record['date']}T00:00:00Z"
        item = {"id": f"arlington:opencities:{record['id']}:{record['date']}", "title": record["title"], "date": record["date"], "startsAt": starts, "endsAt": starts, "locationLabel": record["location"], "venueAddress": record["location"], "summary": "A public meeting listed by Arlington County.", "officialUrl": record["url"], "expiresAt": starts, "source": {"name": "Arlington County meeting calendar", "url": URL, "authorityTier": "county_government", "reviewStatus": "verified"}}
        payload["artifacts"]["events"]["items"].append(item)
        payload["artifacts"]["meetings"]["items"].append(item)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"eventSource": EVENT_SOURCE, "meetingSource": MEETING_SOURCE, "records": len(records), "publishedEvents": len(records), "publishedMeetings": len(records)}))

if __name__ == "__main__":
    main()
