import json
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "motherbird/regions/seattle/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
SOURCE_ID = "events-seattle-gov-cca4136c"
SOURCE_URL = "https://www.seattle.gov/event-calendar"
ENDPOINT = "https://www.trumba.com/calendars/seattlegov-city-wide.json"
GENERATED_AT = "2026-09-30T00:00:00Z"
EXCLUDED = ("committee", "hearing", "oversight", "habitat enhancement", "blackberries", "forest work", "restoration event", "land and culture tending", "volunteer")

def records():
    cutoff = datetime.fromisoformat(GENERATED_AT.replace("Z", "+00:00"))
    source = {"authorityTier": "local_government", "name": "City of Seattle Event Calendar", "reviewStatus": "verified", "url": SOURCE_URL}
    result = []
    for event in requests.get(ENDPOINT, timeout=30).json():
        start = event.get("startDateTime")
        end = event.get("endDateTime")
        title = unescape(event.get("title", "")).strip()
        official_url = event.get("permaLinkUrl", "")
        location = BeautifulSoup(event.get("location", ""), "html.parser").get_text(" ", strip=True)
        if not start or not end or not location or event.get("repeats") or event.get("canceled") or not official_url.startswith("https://www.seattle.gov/") or any(term in title.lower() for term in EXCLUDED):
            continue
        offset = event.get("startTimeZoneOffset", "-0700")
        start_iso = f"{start}{offset[:3]}:{offset[3:]}"
        end_offset = event.get("endTimeZoneOffset", offset)
        end_iso = f"{end}{end_offset[:3]}:{end_offset[3:]}"
        if datetime.fromisoformat(start_iso).astimezone(timezone.utc) < cutoff:
            continue
        result.append({"id": f"seattle-trumba:{event['eventID']}", "title": title, "date": start[:10], "startsAt": start_iso, "endsAt": end_iso, "expiresAt": end_iso.replace("-07:00", "Z").replace("-08:00", "Z"), "locationLabel": location, "venueAddress": location, "summary": BeautifulSoup(event.get("description", ""), "html.parser").get_text(" ", strip=True) or f"Official Seattle event calendar listing for {title}.", "officialUrl": official_url, "source": source})
    return result

def main():
    items = records()
    if not items:
        raise SystemExit("No validated Seattle records found")
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    events = package["artifacts"]["events"]
    existing = {item["id"]: item for item in events["items"] if not item["id"].startswith("seattle-trumba:")}
    existing.update({item["id"]: item for item in items})
    events["items"] = list(existing.values())
    events["generatedAt"] = GENERATED_AT
    package["generatedAt"] = GENERATED_AT
    PACKAGE.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region.get("queue", []):
            if item.get("id") == SOURCE_ID:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = {"integratedAt": GENERATED_AT, "recordCount": len(items), "verifiedSourceFormat": "official calendar vendor JSON feed embedded by Seattle.gov", "verifiedSourceUrl": ENDPOINT, "notes": "Published future non-recurring records with explicit times, locations, stable event IDs, and Seattle.gov permalinks; meetings and volunteer-work listings were excluded."}
    backlog["generatedAt"] = GENERATED_AT
    backlog["summary"]["integratedStaticCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") == "INTEGRATED_STATIC")
    backlog["summary"]["unresolvedCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") != "INTEGRATED_STATIC")
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
