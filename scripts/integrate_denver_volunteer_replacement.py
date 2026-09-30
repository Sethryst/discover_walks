"""Publish contract-compliant Denver volunteer records from the official Engage calendar."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/denver/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"


def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    payload["generatedAt"] = "2026-09-30T00:00:00Z"
    events = payload["artifacts"]["events"]
    events["generatedAt"] = payload["generatedAt"]
    source = {
        "authorityTier": "local_government",
        "name": "City and County of Denver Parks and Recreation",
        "reviewStatus": "verified",
        "url": "https://engagedenver.denvergov.org/Calendar",
    }
    records = [
        {
            "date": "2026-09-30",
            "endsAt": "2026-09-30T11:30:00-06:00",
            "expiresAt": "2026-10-01T06:00:00Z",
            "id": "denver-engage:a6f51d2e-0bcf-45dd-a2b7-0b045611e2a8:2026-09-30",
            "locationLabel": "West-Bar-Val-Wood Park, Denver, CO",
            "officialUrl": "https://engagedenver.denvergov.org/PublicActivityVolunteerRegistration/a6f51d2e-0bcf-45dd-a2b7-0b045611e2a8",
            "source": source,
            "startsAt": "2026-09-30T09:30:00-06:00",
            "summary": "Denver Parks and Recreation volunteer cleanup at West-Bar-Val-Wood Park.",
            "title": "West-Bar-Val-Wood Park Cleanup",
            "venueAddress": "West-Bar-Val-Wood Park, Denver, CO",
        },
        {
            "date": "2026-09-30",
            "endsAt": "2026-09-30T11:00:00-06:00",
            "expiresAt": "2026-10-01T06:00:00Z",
            "id": "denver-engage:7329433b-e4f2-4ba8-b748-2bcbdb15311b:2026-09-30",
            "locationLabel": "Harvey Lake Park, Denver, CO",
            "officialUrl": "https://engagedenver.denvergov.org/PublicActivityVolunteerRegistration/7329433b-e4f2-4ba8-b748-2bcbdb15311b",
            "source": source,
            "startsAt": "2026-09-30T09:00:00-06:00",
            "summary": "Denver Parks and Recreation volunteer cleanup and flowerbed adoption at Harvey Lake Park.",
            "title": "Harvey Park Cleanup & Flowerbed Adoption",
            "venueAddress": "Harvey Lake Park, Denver, CO",
        },
    ]
    existing = {item["id"] for item in events["items"]}
    events["items"].extend(item for item in records if item["id"] not in existing)
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "volunteer-denvergov-org-ffc494c0":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 2 dated/location-backed Denver Parks volunteer records from the official Engage public calendar HTML selector, with stable activity UUIDs and checked 2026-09-30."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
