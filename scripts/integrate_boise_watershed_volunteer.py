import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "motherbird/regions/boise-meridian-idaho/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
SOURCE_ID = "volunteer-boisewatershed-org-b6e8d60b"
SOURCE_URL = "https://www.boisewatershed.org/about/volunteer/"
GENERATED_AT = "2026-09-30T00:00:00Z"
ITEM = {
    "id": "boise-watershed-volunteer:3161:2026-10-14",
    "title": "Climate Action Volunteer Event: Rolling Tomato",
    "date": "2026-10-14",
    "startsAt": "2026-10-14T10:00:00-06:00",
    "endsAt": "2026-10-14T11:00:00-06:00",
    "expiresAt": "2026-10-15T06:00:00Z",
    "locationLabel": "Charlie’s Produce, Boise, ID",
    "venueAddress": "1262 Exchange St, Boise, ID",
    "officialUrl": SOURCE_URL,
    "organizer": {"id": "city-boise-watershed", "name": "City of Boise WaterShed"},
    "participation": {"riskClarity": "Outdoor work and lifting are expected; wear warm clothing and closed-toe shoes.", "timeCommitment": "One hour on October 14, 2026; registration is required.", "whatYouWillDo": "Help Rolling Tomato sort and load surplus food for distribution to community partners."},
    "summary": "Join the City of Boise and Rolling Tomato to sort and load recovered food for community partners.",
    "source": {"authorityTier": "local_government", "name": "City of Boise WaterShed", "reviewStatus": "verified", "url": SOURCE_URL},
}

def main():
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    volunteer = package["artifacts"]["volunteer"]
    existing = {item["id"]: item for item in volunteer["items"]}
    existing[ITEM["id"]] = ITEM
    volunteer["items"] = list(existing.values())
    volunteer["generatedAt"] = GENERATED_AT
    package["generatedAt"] = GENERATED_AT
    PACKAGE.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region.get("queue", []):
            if item.get("id") == SOURCE_ID:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = {"integratedAt": GENERATED_AT, "recordCount": 1, "verifiedSourceFormat": "official embedded calendar JSON", "verifiedSourceUrl": SOURCE_URL, "notes": "The official page embedded calendar item 3161 with explicit date, time, location, volunteer activity, and registration requirement."}
    backlog["generatedAt"] = GENERATED_AT
    backlog["summary"]["integratedStaticCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") == "INTEGRATED_STATIC")
    backlog["summary"]["unresolvedCount"] = sum(1 for region in backlog["regions"] for item in region.get("queue", []) if item.get("trackingState") != "INTEGRATED_STATIC")
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
