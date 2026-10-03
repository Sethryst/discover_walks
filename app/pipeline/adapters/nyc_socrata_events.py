"""Bounded NYC Parks Socrata event adapter with explicit time restrictions."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.event_identity import fallback_event_id
from app.pipeline.intermediate import IntermediateFeature


class NycSocrataEventsProvider(SourceAdapter):
    """Keep NYC date_and_time as an unspecified wall-time string."""
    def acquire(self, source, region):
        with urlopen(Request(source.url, headers={"Accept":"application/json", "User-Agent":"Gremlin-Lab/1.0"}), timeout=60) as response:
            rows = json.loads(response.read())
            last_modified = response.headers.get("Last-Modified")
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features = []
        for row in rows[:int(source.provider_options.get("limit", 250))]:
            title = row.get("event_name") or row.get("title")
            date = row.get("date_and_time") or row.get("starttime")
            location = row.get("location", "")
            if not title or not date: continue
            url = source.url.split("?", 1)[0]
            event_id = str(row.get("guid") or fallback_event_id(url, title, date, location))
            props = {"name": title, "startsAt": date, "timeSemantics": "unspecified-wall-time", "publishable": False, "location": location, "borough": row.get("borough"), "eventType": row.get("event_type"), "category": row.get("category"), "sourceRecord": row}
            features.append(IntermediateFeature(event_id, source.name, source.url, {"type":"Point","coordinates":source.provider_options.get("defaultCoordinates", [-73.9857,40.7484])}, props, stamp, {"rawFormat":"socrata-json","sourceMetadata":{"sourceConfigId":source.id,"freshnessPolicy":"one-month-publication-delay","lastModified":last_modified},"confidence":source.confidence}))
        return features, {"format":"socrata-json","recordCount":len(rows),"acceptedCount":len(features),"freshnessPolicy":"one-month-publication-delay","timeSemantics":"unspecified-wall-time"}
