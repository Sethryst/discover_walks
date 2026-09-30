import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "motherbird/regions/boise-meridian-idaho/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
SOURCE_ID = "events-boisestatepublicradio-org-1b57dd9c"
SOURCE_URL = "https://www.boisestatepublicradio.org/community-calendar-search"
GENERATED_AT = "2026-09-30T00:00:00Z"
ITEM = {"id": "boise-public-radio:art-show-in-pursuit-of-light:2026-10-01", "title": "ART SHOW | In Pursuit of Light | by Bill Garibyan", "date": "2026-10-01", "startsAt": "2026-10-01T17:00:00-06:00", "endsAt": "2026-10-01T21:00:00-06:00", "expiresAt": "2026-10-02T06:00:00Z", "locationLabel": "Idaho Art Gallery, Downtown Boise", "venueAddress": "Idaho Art Gallery, 702 W Idaho St #105, Boise, ID", "summary": "Opening reception for In Pursuit of Light, an exhibition by Bill Garibyan, on view September 29 through October 31.", "officialUrl": "https://www.boisestatepublicradio.org/community-calendar-search/event/art-show-in-pursuit-of-light-by-bill-garibyan-14-09-2026-20-28-15", "source": {"authorityTier": "local_media", "name": "Boise State Public Radio Community Calendar", "reviewStatus": "verified", "url": SOURCE_URL}}

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
                item["integrationEvidence"] = {"integratedAt": GENERATED_AT, "recordCount": 1, "verifiedSourceFormat": "official HTML event detail page", "verifiedSourceUrl": ITEM["officialUrl"], "notes": "Published one non-recurring listing with explicit date, time, venue address, stable detail slug, and official Boise State Public Radio URL; recurring and incomplete-location listings were excluded."}
    backlog["generatedAt"] = GENERATED_AT
    backlog["summary"]["integratedStaticCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") == "INTEGRATED_STATIC")
    backlog["summary"]["unresolvedCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") != "INTEGRATED_STATIC")
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
