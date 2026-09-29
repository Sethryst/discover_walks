"""Capture future schema.org Event records from backlog sources into civic packages.

This is deliberately conservative: only explicit Event JSON-LD with a parseable
start date is published. Directory links without dates remain internal backlog work.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.source_config import SourceConfig

SOURCES = [
    ("events-blackhistory-pgparks-com-49fafbc4", "Prince George's County Parks", "prince-georges-county", "https://blackhistory.pgparks.com/activities-events-events/category/free"),
    ("events-pgparks-com-005aa0a6", "Prince George's County Parks", "prince-georges-county", "https://www.pgparks.com/events"),
]


def main() -> None:
    provider = JsonLdEventsProvider()
    now = datetime.now(timezone.utc)
    for source_id, name, region, url in SOURCES:
        config = SourceConfig(
            id=source_id, name=name, provider="jsonld_events", url=url,
            domains=("event",), license_url=url,
            provider_options={"defaultCoordinates": [-76.8, 38.9], "limit": 250},
        )
        features, report = provider.acquire(config, {})
        path = ROOT / "motherbird" / "regions" / region / "civic" / "index.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        events = payload["artifacts"]["events"]["items"]
        existing = {item["id"] for item in events}
        added = 0
        for feature in features:
            starts = feature.properties.get("startsAt")
            if not starts:
                continue
            try:
                start = datetime.fromisoformat(starts.replace("Z", "+00:00"))
            except ValueError:
                continue
            if start <= now:
                continue
            event_id = f"backlog:{source_id}:{feature.source_id}"
            if event_id in existing:
                continue
            location = feature.properties.get("venueAddress") or "Prince George's County"
            events.append({
                "id": event_id,
                "title": feature.properties["name"],
                "date": start.date().isoformat(),
                "startsAt": starts,
                "endsAt": feature.properties.get("endsAt"),
                "locationLabel": location,
                "summary": feature.properties.get("summary") or f"An event listed by {name}.",
                "officialUrl": feature.properties.get("officialUrl") or url,
                "expiresAt": f"{start.date().isoformat()}T23:59:59Z",
                "source": {"name": name, "url": url, "reviewStatus": "adapter-captured"},
            })
            added += 1
        if added:
            payload["artifacts"]["events"]["items"] = events
            path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"source": source_id, "report": report, "features": len(features), "added": added}))


if __name__ == "__main__":
    main()
