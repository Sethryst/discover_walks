import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "motherbird/regions/portland-maine/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
SOURCE_ID = "events-mainepublic-org-bfb30cd0"
SOURCE_URL = "https://www.mainepublic.org/community-calendar"
GENERATED_AT = "2026-09-30T00:00:00Z"
ITEM = {"id": "maine-public:collins-center-maxwell-quartet:2026-10-25", "title": "Live Music: Traditional Collins Center: Maxwell Quartet", "date": "2026-10-25", "startsAt": "2026-10-25T15:00:00-04:00", "endsAt": "2026-10-25T16:30:00-04:00", "expiresAt": "2026-10-26T04:00:00Z", "locationLabel": "Minsky Recital Hall, Orono, ME", "venueAddress": "Minsky Recital Hall, Orono, ME", "summary": "The Maxwell Quartet performs Haydn, Beethoven, and a new work by Eleanor Alberga at the Minsky Recital Hall in Orono.", "officialUrl": "https://www.mainepublic.org/community-calendar/event/collins-center-maxwell-quartet-28-09-2026-13-44-36", "source": {"authorityTier": "local_media", "name": "Maine Public Community Calendar", "reviewStatus": "verified", "url": SOURCE_URL}}

def main():
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    events = package["artifacts"]["events"]
    existing = {item["id"]: item for item in events["items"]}
    existing[ITEM["id"]] = ITEM
    events["items"] = list(existing.values())
    events["generatedAt"] = GENERATED_AT
    package["generatedAt"] = GENERATED_AT
    PACKAGE.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region.get("queue", []):
            if item.get("id") == SOURCE_ID:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = {"integratedAt": GENERATED_AT, "recordCount": 1, "verifiedSourceFormat": "official HTML event detail page", "verifiedSourceUrl": ITEM["officialUrl"], "notes": "Published one listing with an explicit date, time, venue, and stable official detail URL; recurring and conflicting listings were excluded."}
    backlog["generatedAt"] = GENERATED_AT
    backlog["summary"]["integratedStaticCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") == "INTEGRATED_STATIC")
    backlog["summary"]["unresolvedCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") != "INTEGRATED_STATIC")
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
