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

CATALOGUE = ROOT / "motherbird" / "data" / "learn" / "source-adapters.json"


def main() -> None:
    provider = JsonLdEventsProvider()
    now = datetime.now(timezone.utc)
    records = json.loads(CATALOGUE.read_text(encoding="utf-8"))["records"]
    for record in records:
        if not record["id"].startswith("events-") or record["regionId"] in {"philadelphia", "prince-georges-county-md"}:
            continue
        source_id, name, region, url = record["id"], record["publisher"], record["regionId"], record["url"]
        config = SourceConfig(
            id=source_id, name=name, provider="jsonld_events", url=url,
            domains=("event",), license_url=url,
            provider_options={"defaultCoordinates": [-76.8, 38.9], "limit": 250},
        )
        try:
            features, report = provider.acquire(config, {})
        except Exception as exc:
            print(json.dumps({"source": source_id, "skipped": type(exc).__name__}))
            continue
        path = ROOT / "motherbird" / "regions" / region / "civic" / "index.json"
        if not path.exists():
            print(json.dumps({"source": source_id, "skipped": "no civic package"}))
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        if "events" not in payload.get("artifacts", {}):
            print(json.dumps({"source": source_id, "skipped": "no events contract"}))
            continue
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
