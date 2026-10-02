"""Bounded parser for Cleveland's Drupal FullCalendar event configuration."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature


class ClevelandFullCalendarProvider(SourceAdapter):
    """Read the official embedded calendar JSON, not arbitrary page links."""

    def acquire(self, source, region):
        try:
            with urlopen(Request(source.url, headers={"Accept": "text/html", "User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
                html = response.read().decode("utf-8", "replace")
        except OSError as exc:
            raise RetryableGremlinError(f"Cleveland calendar acquisition failed for {source.id}") from exc
        match = re.search(r'calendar_options":"(?P<value>.*?)","dialog_options"', html, re.S)
        if not match:
            return [], {"format": "drupal-fullcalendar-json", "recordCount": 0, "acceptedCount": 0, "reason": "calendar_options_missing"}
        try:
            options = json.loads(json.loads('"' + match.group("value") + '"'))
        except (TypeError, ValueError, json.JSONDecodeError):
            return [], {"format": "drupal-fullcalendar-json", "recordCount": 0, "acceptedCount": 0, "reason": "calendar_options_invalid"}
        records = options.get("events", [])
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        point = source.provider_options.get("defaultCoordinates", [-81.6944, 41.4993])
        features = []
        for row in records[:int(source.provider_options.get("limit", 250))]:
            title, start = (row.get("title") or "").strip(), row.get("start")
            if not title or not start:
                continue
            official_url = urljoin(source.url, row.get("url") or "/events")
            event_id = str(row.get("eid") or row.get("id") or sha256(f"{source.id}|{title}|{start}|{official_url}".encode()).hexdigest()[:20])
            props = {"name": title, "startsAt": start, "officialUrl": official_url, "summary": row.get("des") or "", "timeSemantics": "source-local-calendar", "publishable": False}
            features.append(IntermediateFeature(event_id, source.name, source.url, {"type": "Point", "coordinates": point}, props, stamp, {"rawFormat": "drupal-fullcalendar-json", "sourceMetadata": {"sourceConfigId": source.id, "timeZone": options.get("timeZone")}, "confidence": source.confidence}))
        return features, {"format": "drupal-fullcalendar-json", "recordCount": len(records), "acceptedCount": len(features), "timeZone": options.get("timeZone")}
