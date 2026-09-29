"""Capture dated events from the Seattle.net local API into the static civic package."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "events-seattle-net-25130bd8"
API_URL = "https://seattle.net/api/events"

def main() -> None:
    with urlopen(Request(API_URL, headers={"Accept": "application/json", "User-Agent": "Gremlin-Lab/1.0"}), timeout=30) as response:
        feed = json.loads(response.read().decode("utf-8"))
    path = ROOT / "motherbird/regions/seattle/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload["artifacts"]["events"]["items"]
    existing = {item["id"] for item in items}
    today = datetime.now(timezone.utc).date()
    added = 0
    for event in feed.get("events", []):
        date = event.get("date")
        if not date or date < today.isoformat() or not event.get("name"):
            continue
        event_id = f"backlog:{SOURCE_ID}:{event.get('id') or event['name']}"
        if event_id in existing:
            continue
        time = event.get("time") or "00:00:00"
        items.append({
            "id": event_id,
            "title": event["name"],
            "date": date,
            "startsAt": f"{date}T{time}-07:00",
            "locationLabel": ", ".join(x for x in (event.get("venue"), event.get("address")) if x) or "Seattle",
            "summary": f"{event.get('category') or 'Community'} event listed by Seattle.net.",
            "officialUrl": event.get("url") or API_URL,
            "expiresAt": f"{date}T23:59:59-07:00",
            "source": {"name": "Seattle.net local events API", "url": API_URL, "reviewStatus": "adapter-captured"},
        })
        added += 1
    payload["artifacts"]["events"]["items"] = items
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"feedRecords": len(feed.get("events", [])), "added": added}))

if __name__ == "__main__":
    main()
