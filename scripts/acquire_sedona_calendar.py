"""Publish browser-verified Sedona calendar records from official detail pages.

The calendar shell currently denies non-browser HTTP clients.  The records below
are a bounded replay of the October 2026 month view and its detail pages,
captured through the public browser-rendered calendar.  Cancelled listings are
intentionally excluded.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("motherbird/regions/sedona-arizona/civic/index.json")
CALENDAR = "https://www.sedonaaz.gov/your-government/general-information/city-calendar"

RECORDS = [
    ("20029", "2026-10-03", "Sedona Police Community Outreach event", "Posse Grounds Park, The HUB — 525 Posse Ground Rd., Sedona, Arizona 86336"),
    ("20039", "2026-10-06", "Planning & Zoning Land Development Code Critique Open House", "Posse Grounds Park, The HUB — 525 Posse Ground Rd., Sedona, Arizona 86336"),
    ("19849", "2026-10-13", "City Council Meeting - Executive Session", "City Council Chambers — 102 Roadrunner Drive, Sedona, Arizona 86336"),
    ("19847", "2026-10-14", "City Council - Special Meeting", "City Council Chambers — 102 Roadrunner Drive, Sedona, Arizona 86336"),
    ("19253", "2026-10-17", "The Great Pumpkin Splash!", "Sedona Community Pool — 570 Posse Grounds Rd., Sedona, Arizona 86336"),
    ("19299", "2026-10-17", "Fest of Fall", "Posse Grounds Park — 525 Posse Ground Rd., Sedona, Arizona 86336"),
    ("20031", "2026-10-22", "City Hall Art Rotation - Artist Reception", "City Council Chambers — 102 Roadrunner Drive, Sedona, Arizona 86336"),
    ("19877", "2026-10-24", "Household Hazardous Waste & Electronics Collection Event", "Sedona Red Rock High School — 995 Upper Red Rock Loop Rd., Sedona, Arizona 86336"),
    ("19848", "2026-10-27", "City Council Meeting", "City Council Chambers — 102 Roadrunner Drive, Sedona, Arizona 86336"),
    ("19255", "2026-10-31", "Uptown Trick or Treat", "Uptown Sedona — 200 N. SR 89A, Sedona, Arizona 86336"),
]


def main() -> None:
    payload = json.loads(OUT.read_text(encoding="utf-8"))
    stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    events = payload["artifacts"].setdefault("events", {"items": []})
    meetings = payload["artifacts"].setdefault("meetings", {"items": []})
    for node, day, title, location in RECORDS:
        detail = f"{CALENDAR.replace('/your-government/general-information/city-calendar', '')}/Home/Components/Calendar/Event/{node}/25?curm=10&cury=2026"
        item = {
            "date": day,
            "id": f"sedona:{node}:{day}",
            "locationLabel": location,
            "officialUrl": detail,
            "source": {"authorityTier": "local_government", "name": "City of Sedona", "reviewStatus": "verified", "url": CALENDAR},
            "summary": "Official City of Sedona calendar listing.",
            "title": title,
            "venueAddress": location,
        }
        target = meetings if "Meeting" in title or "Council" in title else events
        existing = {x["id"]: x for x in target.get("items", [])}
        existing[item["id"]] = item
        target["items"] = sorted(existing.values(), key=lambda x: (x.get("date", ""), x["id"]))
        target["generatedAt"] = stamp
    payload["generatedAt"] = stamp
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"events": len(events["items"]), "meetings": len(meetings["items"]), "added": len(RECORDS)}))


if __name__ == "__main__":
    main()
