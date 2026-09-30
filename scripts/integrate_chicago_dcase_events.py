import json
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "motherbird/regions/chicago/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
SOURCE_ID = "events-chicago-gov-83a3ca20"
SOURCE_URL = "https://www.chicago.gov/city/en/depts/dca/supp_info/events2.html"
ENDPOINT = "https://www.chicago.gov/content/city/en/depts/dca/supp_info/events2/jcr:content/parsys/fullcalendar/calendarData"
GENERATED_AT = "2026-09-30T00:00:00Z"

def future_records():
    payload = requests.get(ENDPOINT, timeout=30).json()
    cutoff = datetime.fromisoformat(GENERATED_AT.replace("Z", "+00:00"))
    source = {"authorityTier": "local_government", "name": "City of Chicago Department of Cultural Affairs and Special Events", "reviewStatus": "verified", "url": SOURCE_URL}
    records = []
    for event in payload:
        start = event.get("start")
        end = event.get("end")
        official_url = event.get("url", "")
        try:
            starts_at = datetime.fromisoformat(start) if start else None
        except ValueError:
            starts_at = None
        if not starts_at or starts_at < cutoff or not end or event.get("repeats") != "norepeat" or not event.get("address1") or not event.get("city") or not event.get("state") or not event.get("zip") or not official_url.startswith("https://www.chicago.gov/"):
            continue
        location = ", ".join(part for part in [event.get("address1"), event.get("address2"), event.get("city"), event.get("state"), event.get("zip")] if part)
        records.append({"id": f"chicago-dcase:{event['id']}", "title": event["title"], "date": start[:10], "startsAt": start, "endsAt": end, "expiresAt": end.replace("-05:00", "Z").replace("-06:00", "Z"), "locationLabel": location, "venueAddress": location, "summary": event.get("description") or f"Official DCASE listing for {event['title']}.", "officialUrl": official_url, "source": source})
    return records

def main():
    records = future_records()
    if not records:
        raise SystemExit("No validated future Chicago DCASE records found")
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    events = package["artifacts"].setdefault("events", {"generatedAt": GENERATED_AT, "producer": {"name": "Gremlin Lab", "version": "development"}, "regionId": "chicago", "schemaVersion": 1, "items": []})
    existing = {item["id"]: item for item in events["items"]}
    existing.update({item["id"]: item for item in records})
    events["items"] = list(existing.values())
    events["generatedAt"] = GENERATED_AT
    package["generatedAt"] = GENERATED_AT
    PACKAGE.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region.get("queue", []):
            if item.get("id") == SOURCE_ID:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = {"integratedAt": GENERATED_AT, "recordCount": len(records), "verifiedSourceFormat": "official JSON calendar endpoint", "verifiedSourceUrl": ENDPOINT, "notes": "Published future non-recurring records with explicit times, addresses, stable numeric IDs, and chicago.gov detail URLs; third-party registration URLs were excluded."}
    backlog["generatedAt"] = GENERATED_AT
    backlog["summary"]["integratedStaticCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") == "INTEGRATED_STATIC")
    backlog["summary"]["unresolvedCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") != "INTEGRATED_STATIC")
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
