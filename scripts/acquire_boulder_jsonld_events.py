"""Publish validated future Boulder County Open Space JSON-LD events."""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.source_config import SourceConfig

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "volunteer-bouldercounty-gov-e331dd88"
URL = "https://bouldercounty.gov/open-space/activities/calendar/"

def main():
    now = datetime.now(timezone.utc)
    source = SourceConfig(id=SOURCE_ID, name="Boulder County Open Space Activities", provider="jsonld_events", url=URL, domains=("event",), license_url=URL, provider_options={"limit": 250})
    features, report = JsonLdEventsProvider().acquire(source, {})
    path = ROOT / "motherbird/regions/boulder/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    artifact = payload.setdefault("artifacts", {}).setdefault("events", {"schemaVersion": 1, "regionId": "boulder", "producer": "boulder-jsonld-static", "generatedAt": now.isoformat().replace("+00:00", "Z"), "items": []})
    existing = {item["id"] for item in artifact["items"]}
    added = 0
    for feature in features:
        props, coords = feature.properties, feature.geometry.get("coordinates")
        try: start = datetime.fromisoformat(str(props["startsAt"]).replace("Z", "+00:00"))
        except (KeyError, ValueError): continue
        if start <= now or not coords or len(coords) < 2: continue
        event_id = f"boulder:jsonld:{feature.source_id}"
        if event_id in existing: continue
        item = {"id": event_id, "title": props["name"], "date": start.date().isoformat(), "startsAt": props["startsAt"], "endsAt": props.get("endsAt"), "locationLabel": props.get("venueAddress") or "Boulder County Open Space", "summary": props.get("summary") or "An event listed by Boulder County Open Space.", "officialUrl": props.get("officialUrl") or URL, "expiresAt": props.get("endsAt") or props["startsAt"], "latitude": coords[1], "longitude": coords[0], "source": {"name": source.name, "url": URL, "authorityTier": "county_government", "reviewStatus": "verified"}}
        artifact["items"].append(item); added += 1
    artifact["generatedAt"] = now.isoformat().replace("+00:00", "Z")
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "adapter": report["format"], "discovered": report["recordCount"], "acceptedByAdapter": report["acceptedCount"], "published": added, "rejectedForDateOrGeometry": report["acceptedCount"] - added}))
if __name__ == "__main__": main()
