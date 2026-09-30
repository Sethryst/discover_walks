import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "motherbird/regions/norfolk/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
SOURCE_ID = "events-downtownnorfolk-org-cf7e9296"
URL = "https://www.downtownnorfolk.org/explore/calendar"
GENERATED_AT = "2026-09-30T00:00:00Z"
VALUES = [
    ("womens-leadership-and-self-care-summit", "Women’s Leadership and Self-Care Summit", "2026-09-30T08:30:00-04:00", "2026-09-30T12:00:00-04:00", "Assembly — 400 Granby Street, Norfolk, VA 23510", "https://www.downtownnorfolk.org/event/womens-leadership-and-self-care-summit"),
    ("business-underground", "Business Underground", "2026-10-01T18:00:00-04:00", "2026-10-01T20:00:00-04:00", "The Slover — 235 East Plume St, Norfolk, VA", "https://www.downtownnorfolk.org/event/business-underground"),
    ("unleash-2026", "Unleash 2026", "2026-10-02T09:00:00-04:00", "2026-10-02T16:00:00-04:00", "Town Point Club — 101 West Main St, Norfolk, VA", "https://www.downtownnorfolk.org/event/unleash-2026"),
]

def main():
    source = {"authorityTier": "local_organization", "name": "Downtown Norfolk Council", "reviewStatus": "verified", "url": URL}
    items = [{"id": f"downtown-norfolk:{slug}:{start[:10]}", "title": title, "date": start[:10], "startsAt": start, "endsAt": end, "expiresAt": end.replace("-04:00", "Z"), "locationLabel": location, "venueAddress": location, "summary": f"Official Downtown Norfolk Council listing for {title}.", "officialUrl": official_url, "source": source} for slug, title, start, end, location, official_url in VALUES]
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    events = package["artifacts"]["events"]
    existing = {item["id"]: item for item in events["items"]}
    existing.update({item["id"]: item for item in items})
    events["items"] = list(existing.values())
    events["generatedAt"] = GENERATED_AT
    package["generatedAt"] = GENERATED_AT
    PACKAGE.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    found = False
    for region in backlog["regions"]:
        for item in region.get("queue", []):
            if item.get("id") == SOURCE_ID:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = {"integratedAt": GENERATED_AT, "recordCount": 3, "verifiedSourceFormat": "official HTML event detail pages", "verifiedSourceUrl": URL, "notes": "Three current/future detail pages exposed explicit date, time, location, and canonical URLs; the volunteer listing was kept out of the events package."}
                found = True
    if not found:
        raise SystemExit(f"Backlog source not found: {SOURCE_ID}")
    backlog["generatedAt"] = GENERATED_AT
    backlog["summary"]["integratedStaticCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") == "INTEGRATED_STATIC")
    backlog["summary"]["unresolvedCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") != "INTEGRATED_STATIC")
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
