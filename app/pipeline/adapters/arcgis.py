"""ArcGIS Feature Service provider with pagination and WGS84 GeoJSON output."""

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


class ArcGisFeatureServiceProvider(SourceAdapter):
    """Query public or token-authenticated ArcGIS Feature Service layers."""

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        """Page through a FeatureServer layer and emit lossless GeoJSON intermediate features."""
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        all_features: list[dict[str, Any]] = []
        offset = 0
        while True:
            parameters = {"where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "geojson", "resultOffset": str(offset), "resultRecordCount": "1000", **source.query_params}
            if source.credential():
                parameters["token"] = source.credential() or ""
            url = f"{source.url.rstrip('/')}/query?{urlencode(parameters)}"
            body = self._request(url, source.id)
            batch = body.get("features", [])
            all_features.extend(batch)
            if not body.get("exceededTransferLimit") or not batch:
                break
            offset += len(batch)
        raw = {"type": "FeatureCollection", "features": all_features}
        return self.parse(raw, source, timestamp), raw

    def parse(self, raw: dict[str, Any], source: SourceConfig, timestamp: str) -> list[IntermediateFeature]:
        """Recreate intermediate features from a cached ArcGIS GeoJSON response."""
        output: list[IntermediateFeature] = []
        for index, feature in enumerate(raw.get("features", [])):
            properties = feature.get("properties") or {}
            geometry = feature.get("geometry")
            if not geometry:
                continue
            mapped_id = source.property_mapping.get("id")
            identifier = str(properties.get(mapped_id) or feature.get("id", properties.get("OBJECTID", properties.get("objectid", index))))
            output.append(IntermediateFeature(identifier, source.name, source.url, geometry, dict(properties), timestamp, {"rawFormat": "arcgis", "sourceMetadata": {"sourceConfigId": source.id, "layerUrl": source.url, "propertyMapping": source.property_mapping}, "confidence": source.confidence}))
        return output

    def _request(self, url: str, source_id: str) -> dict[str, Any]:
        try:
            with urlopen(Request(url, headers={"Accept": "application/geo+json, application/json", "User-Agent": "Gremlin-Lab/1.0"}), timeout=75) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"ArcGIS acquisition failed for {source_id}: {exc}") from exc
        if payload.get("error"):
            raise ValueError(f"ArcGIS source {source_id} returned: {payload['error'].get('message', payload['error'])}")
        return payload
