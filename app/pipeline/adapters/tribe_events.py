"""Adapter for public The Events Calendar REST feeds used by official agencies."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class TribeEventsProvider(SourceAdapter):
    """Acquire official event records, withholding events that lack mapped venues."""
    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        params = {"per_page": source.provider_options.get("perPage", 100)}
        try:
            request = Request(f"{source.url}?{urlencode(params)}", headers={"Accept": "application/json", "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=60) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"Event acquisition failed for {source.id}: {exc}") from exc
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features = []
        for event in raw.get("events", []):
            venue = event.get("venue") or {}
            try:
                latitude, longitude = float(venue["geo_lat"]), float(venue["geo_lng"])
            except (KeyError, TypeError, ValueError):
                continue
            properties = dict(event)
            categories = event.get("categories") or []
            properties.update({"name": event.get("title"), "startsAt": _utc(event.get("utc_start_date") or event.get("start_date")), "endsAt": _utc(event.get("utc_end_date") or event.get("end_date")), "eventType": categories[0].get("name") if categories else "event"})
            if properties["name"] and properties["startsAt"]:
                features.append(IntermediateFeature(str(event["id"]), source.name, source.url, {"type": "Point", "coordinates": [longitude, latitude]}, properties, timestamp, {"rawFormat": "tribe-events", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, raw


def _utc(value: str | None) -> str | None:
    return f"{value.replace(' ', 'T')}Z" if value else None
