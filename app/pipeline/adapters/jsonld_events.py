"""Schema.org Event JSON-LD adapter for reviewed HTML calendars."""
from __future__ import annotations
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.request import Request, urlopen
from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig

class JsonLdEventsProvider(SourceAdapter):
    """Extract only explicit schema.org Event JSON-LD; no page guessing."""
    def acquire(self, source: SourceConfig, region: dict[str, Any]):
        try:
            with urlopen(Request(source.url, headers={"Accept": "text/html", "User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
                page = response.read().decode("utf-8", "replace")
        except OSError as exc:
            raise RetryableGremlinError(f"JSON-LD event acquisition failed for {source.id}") from exc
        records = []
        for block in re.findall(r'''<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>''', page, flags=re.I | re.S):
            try: payload = json.loads(block.strip())
            except json.JSONDecodeError: continue
            records.extend(_events(payload))
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features = []
        default = source.provider_options.get("defaultCoordinates")
        for event in records[:int(source.provider_options.get("limit", 250))]:
            point = _point(event.get("location"), default)
            if not point or not event.get("name") or not event.get("startDate"): continue
            event_id = str(event.get("identifier") or hashlib.sha256(f"{source.id}|{event['name']}|{event['startDate']}|{event.get('url', source.url)}".encode()).hexdigest()[:20])
            props = {"name": event["name"], "startsAt": event["startDate"], "endsAt": event.get("endDate"), "eventType": event.get("@type", "Event"), "officialUrl": event.get("url") or source.url, "venueAddress": _address(event.get("location")), "summary": event.get("description")}
            features.append(IntermediateFeature(event_id, source.name, source.url, {"type": "Point", "coordinates": point}, props, stamp, {"rawFormat": "schema.org-jsonld", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, {"format": "schema.org-jsonld", "recordCount": len(records), "acceptedCount": len(features)}

def _events(payload):
    if isinstance(payload, list): return [x for item in payload for x in _events(item)]
    if not isinstance(payload, dict): return []
    graph = payload.get("@graph")
    if graph is not None: return [x for item in graph for x in _events(item)]
    types = payload.get("@type", [])
    if isinstance(types, str): types = [types]
    return [payload] if "Event" in types else []

def _point(location, default):
    geo = location.get("geo") if isinstance(location, dict) else None
    if isinstance(geo, dict) and geo.get("longitude") is not None and geo.get("latitude") is not None:
        return [float(geo["longitude"]), float(geo["latitude"])]
    if isinstance(default, dict): default = [default.get("lng"), default.get("lat")]
    if isinstance(default, (list, tuple)) and len(default) == 2:
        try: return [float(default[0]), float(default[1])]
        except (TypeError, ValueError): pass
    return None

def _address(location):
    if isinstance(location, str): return location
    if isinstance(location, dict):
        address = location.get("address")
        if isinstance(address, str): return address
        if isinstance(address, dict): return ", ".join(str(address.get(k)) for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode") if address.get(k))
    return None
