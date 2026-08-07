"""USGS Water Data monitoring-location provider."""
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


class UsgsMonitoringLocationsProvider(SourceAdapter):
    """Acquire source-authoritative USGS monitoring locations in a region bounding box."""
    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        token = source.credential()
        if not token:
            raise ValueError(f"USGS source {source.id} requires {source.credential_env}")
        south, west, north, east = region["bbox"]
        url = f"{source.url}?{urlencode({'bbox': f'{west},{south},{east},{north}', 'limit': source.provider_options.get('limit', 500)})}"
        try:
            request = Request(url, headers={"X-Api-Key": token, "Accept": "application/geo+json", "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=60) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"USGS water acquisition failed for {source.id}: {exc}") from exc
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features = []
        for index, item in enumerate(raw.get("features", [])):
            properties = dict(item.get("properties") or {})
            properties.update({"name": properties.get("monitoring_location_name"), "waterSignalType": "monitoring_location"})
            if item.get("geometry", {}).get("type") == "Point":
                features.append(IntermediateFeature(str(properties.get("id") or properties.get("monitoring_location_number") or index), source.name, source.url, item["geometry"], properties, timestamp, {"rawFormat": "usgs-water-geojson", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, raw
