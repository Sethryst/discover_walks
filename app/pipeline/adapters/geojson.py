"""GeoJSON provider for local files or HTTP endpoints."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class GeoJsonProvider(SourceAdapter):
    """Read a GeoJSON FeatureCollection and preserve every source property."""

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], Any]:
        """Load a local/HTTP GeoJSON FeatureCollection and map it losslessly."""
        body = self._read(source)
        if body.get("type") != "FeatureCollection" or not isinstance(body.get("features"), list):
            raise ValueError(f"{source.id} is not a GeoJSON FeatureCollection")
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features: list[IntermediateFeature] = []
        for index, feature in enumerate(body["features"]):
            geometry = feature.get("geometry")
            properties = feature.get("properties") or {}
            if not geometry:
                continue
            original_id = str(feature.get("id", properties.get("id", index)))
            features.append(IntermediateFeature(original_id, source.name, source.url, geometry, dict(properties), timestamp, {"rawFormat": "geojson", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, body

    def _read(self, source: SourceConfig) -> dict[str, Any]:
        if source.url.startswith(("http://", "https://")):
            headers = {"Accept": "application/geo+json, application/json"}
            if source.credential():
                headers["Authorization"] = f"Bearer {source.credential()}"
            try:
                with urlopen(Request(source.url, headers=headers), timeout=60) as response:
                    return json.loads(response.read().decode("utf-8"))
            except OSError as exc:
                raise RetryableGremlinError(f"GeoJSON acquisition failed for {source.id}: {exc}") from exc
        return json.loads(Path(source.url).read_text(encoding="utf-8"))
