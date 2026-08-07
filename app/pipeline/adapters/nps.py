"""National Park Service events provider with credential-contained acquisition."""

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


class NpsEventsProvider(SourceAdapter):
    """Fetch authoritative NPS events while raw source records remain local cache only."""

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        token = source.credential()
        if not token:
            raise ValueError(f"NPS source {source.id} requires {source.credential_env}")
        raw = self._request(source, token)
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features: list[IntermediateFeature] = []
        for event in raw.get("data", []):
            try:
                latitude, longitude = float(event["latitude"]), float(event["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            source_id = str(event.get("id") or event.get("eventid") or f"{event.get('title', 'event')}:{event.get('datestart', '')}")
            properties = dict(event)
            properties.update({"name": event.get("title"), "startsAt": event.get("datestart") or event.get("date"), "endsAt": event.get("dateend"), "eventType": (event.get("types") or [event.get("category") or "event"])[0], "parkCode": event.get("sitecode")})
            features.append(IntermediateFeature(source_id, source.name, source.url, {"type": "Point", "coordinates": [longitude, latitude]}, properties, timestamp, {"rawFormat": "nps-events", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, raw

    def _request(self, source: SourceConfig, token: str) -> dict[str, Any]:
        params = {"parkCode": source.provider_options.get("parkCode", "wotr"), "pageSize": source.provider_options.get("pageSize", 100)}
        try:
            request = Request(f"{source.url}?{urlencode(params)}", headers={"X-Api-Key": token, "Accept": "application/json", "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"NPS acquisition failed for {source.id}: {exc}") from exc
