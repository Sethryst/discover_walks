"""Acquire Summit Daily's embedded CitySpark event payload."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "events-summitdaily-com-1e792ddf"
URL = "https://www.summitdaily.com/explore-summit/calendar/"
SCRIPT_URL = "https://portal.cityspark.com/PortalScripts/SummitDaily"

def main() -> None:
    text = requests.get(SCRIPT_URL, timeout=60).text
    start = text.index("{", text.index("var cSparkLocals"))
    locals_data = json.JSONDecoder().raw_decode(text[start:])[0]
    now = datetime.now(timezone.utc)
    path = ROOT / "motherbird/regions/keystone-colorado/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    artifact = payload.setdefault("artifacts", {}).setdefault("events", {"schemaVersion": 1, "regionId": "keystone-colorado", "producer": "cityspark-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in artifact["items"]}
    accepted = added = 0
    for record in locals_data.get("Events", []):
        try: event_start = datetime.fromisoformat(record["StartUTC"].replace("Z", "+00:00"))
        except (KeyError, ValueError, TypeError): continue
        if event_start <= now or not record.get("Name") or not record.get("Venue") or not record.get("Address"): continue
        accepted += 1
        event_id = f"summitdaily:cityspark:{record.get('PId')}:{record['StartUTC']}"
        if event_id in existing: continue
        ends = record.get("EndUTC") or record["StartUTC"]
        location = f"{record['Venue']}, {record['Address']}, Summit County, CO {record.get('Zip') or ''}".strip()
        artifact["items"].append({"id": event_id, "title": record["Name"], "date": event_start.date().isoformat(), "startsAt": record["StartUTC"], "endsAt": ends, "locationLabel": location, "venueAddress": location, "summary": record.get("Summary") or "An event listed by Summit Daily's CitySpark calendar.", "officialUrl": record.get("PrimaryUrl") or URL, "expiresAt": ends, "source": {"name": "Summit Daily CitySpark Calendar", "url": URL, "authorityTier": "regional_publisher", "reviewStatus": "verified"}})
        added += 1
    artifact["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "payloadEvents": len(locals_data.get("Events", [])), "acceptedCount": accepted, "published": added}))

if __name__ == "__main__": main()
