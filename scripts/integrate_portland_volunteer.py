"""Publish validated Portland Parks volunteer event pages to the static civic package."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/portland/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"


def main() -> None:
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    generated = "2026-09-30T00:00:00Z"
    events = payload["artifacts"]["events"]
    events["generatedAt"] = generated
    source = {
        "authorityTier": "local_government",
        "name": "Portland Parks & Recreation",
        "reviewStatus": "verified",
        "url": "https://www.portland.gov/parks/volunteer",
    }
    records = [
        {
            "date": "2026-10-01",
            "startsAt": "2026-10-01T10:00:00-07:00",
            "endsAt": "2026-10-01T11:00:00-07:00",
            "expiresAt": "2026-10-02T07:00:00Z",
            "id": "portland-parks:argay-park-volunteer-day:2026-10-01",
            "title": "Argay Park Volunteer Day",
            "summary": "Portland Parks & Recreation volunteer gardening and park-care event.",
            "locationLabel": "Argay Park, Portland, OR",
            "venueAddress": "Argay Park, Portland, OR",
            "officialUrl": "https://www.portland.gov/parks/events/2026/10/1/argay-park-volunteer-day",
            "source": source,
        },
        {
            "date": "2026-10-01",
            "startsAt": "2026-10-01T09:00:00-07:00",
            "endsAt": "2026-10-01T11:00:00-07:00",
            "expiresAt": "2026-10-02T07:00:00Z",
            "id": "portland-parks:mill-park-volunteer-day:2026-10-01",
            "title": "Mill Park Volunteer Day",
            "summary": "Portland Parks & Recreation volunteer gardening and park-care event.",
            "locationLabel": "Mill Park, Portland, OR",
            "venueAddress": "Mill Park, Portland, OR",
            "officialUrl": "https://www.portland.gov/parks/events/2026/10/1/mill-park-volunteer-day",
            "source": source,
        },
        {
            "date": "2026-10-02",
            "startsAt": "2026-10-02T10:00:00-07:00",
            "endsAt": "2026-10-02T13:00:00-07:00",
            "expiresAt": "2026-10-03T07:00:00Z",
            "id": "portland-parks:pier-park-stewardship-day:2026-10-02",
            "title": "Pier Park Stewardship Day",
            "summary": "Portland Parks & Recreation volunteer gardening and park-care event.",
            "locationLabel": "Pier Park, Portland, OR",
            "venueAddress": "Pier Park, Portland, OR",
            "officialUrl": "https://www.portland.gov/parks/events/2026/10/2/pier-park-stewardship-day",
            "source": source,
        },
    ]
    existing = {item["id"] for item in events["items"]}
    events["items"].extend(item for item in records if item["id"] not in existing)
    payload["generatedAt"] = generated
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "volunteer-portland-gov-fe600e12":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = (
                    "Published 3 future dated/location-backed Portland Parks volunteer records "
                    "from official item pages with stable slugs, explicit times, park locations, "
                    "and checked 2026-09-30."
                )
    states: dict[str, int] = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
