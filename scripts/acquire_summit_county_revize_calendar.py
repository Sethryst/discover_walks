"""Acquire Summit County, Colorado's official Revize calendar JSON endpoint."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "meetings-summitcountyco-gov-0e4237c8"
LANDING = "https://www.summitcountyco.gov/calendar.php"
ENDPOINT = "https://www.summitcountyco.gov/_assets_/plugins/revizeCalendar/calendar_data_handler.php?webspace=summitcoco&relative_revize_url=//cms3.revize.com&protocol=https:"

def main() -> None:
    records = requests.get(ENDPOINT, timeout=60).json()
    now = datetime.now(timezone.utc)
    path = ROOT / "motherbird/regions/keystone-colorado/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    artifact = payload.setdefault("artifacts", {}).setdefault("meetings", {"schemaVersion": 1, "regionId": "keystone-colorado", "producer": "revize-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in artifact["items"]}
    accepted = added = 0
    for record in records:
        try: start = datetime.fromisoformat(record["start"]).replace(tzinfo=timezone.utc)
        except (KeyError, ValueError): continue
        if start < now or not record.get("title") or not record.get("location"): continue
        accepted += 1
        event_id = f"summit:revize:{record.get('id')}:{record['start']}"
        if event_id in existing: continue
        ends = record.get("end") or record["start"]
        artifact["items"].append({"id": event_id, "title": record["title"], "date": start.date().isoformat(), "startsAt": record["start"] + "Z", "endsAt": ends + "Z", "locationLabel": record["location"], "venueAddress": record["location"], "summary": "A public meeting listed by Summit County, Colorado.", "officialUrl": LANDING, "expiresAt": ends + "Z", "source": {"name": "Summit County, Colorado Calendar", "url": LANDING, "authorityTier": "county_government", "reviewStatus": "verified"}})
        added += 1
    artifact["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "recordCount": len(records), "acceptedCount": accepted, "published": added}))

if __name__ == "__main__": main()
