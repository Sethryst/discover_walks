"""Acquire Fairfax County's official public-meetings iCalendar feed."""
from __future__ import annotations
import json, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.adapters.rss_ics_events import _parse_ics

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "meetings-fairfaxcounty-gov-6f6370e4"
URL = "https://www.fairfaxcounty.gov/Calendar/Calendar.aspx?cal=1"

def main() -> None:
    records = _parse_ics(urlopen(URL, timeout=60).read().decode("utf-8", "replace"))
    now = datetime.now(timezone.utc)
    path = ROOT / "motherbird/regions/fairfax-county-va/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    artifact = payload.setdefault("artifacts", {}).setdefault("meetings", {"schemaVersion": 1, "regionId": "fairfax-county-va", "producer": "fairfax-ics-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in artifact["items"]}
    accepted = added = 0
    for record in records:
        try: start = datetime.fromisoformat(str(record["startsAt"]).replace("Z", "+00:00"))
        except (KeyError, ValueError): continue
        if start < now or not record.get("name") or not record.get("venueAddress"): continue
        accepted += 1
        event_id = f"fairfax:public-meeting:{record.get('id') or record['name'] + '|' + record['startsAt']}"
        if event_id in existing: continue
        starts = record["startsAt"]
        artifact["items"].append({"id": event_id, "title": record["name"], "date": start.date().isoformat(), "startsAt": starts, "endsAt": record.get("endsAt") or starts, "locationLabel": record["venueAddress"], "venueAddress": record["venueAddress"], "summary": record.get("summary") or "A public meeting listed by Fairfax County.", "officialUrl": URL, "expiresAt": record.get("endsAt") or starts, "source": {"name": "Fairfax County Public Meetings Calendar", "url": URL, "authorityTier": "county_government", "reviewStatus": "verified"}})
        added += 1
    artifact["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "recordCount": len(records), "acceptedCount": accepted, "published": added}))

if __name__ == "__main__": main()
