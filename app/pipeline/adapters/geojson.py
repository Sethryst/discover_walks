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
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return self.parse(body, source, timestamp), body

    def parse(self, body: dict[str, Any], source: SourceConfig, timestamp: str) -> list[IntermediateFeature]:
        """Recreate mapped intermediates from a cached GeoJSON response."""
        if body.get("type") != "FeatureCollection" or not isinstance(body.get("features"), list):
            raise ValueError(f"{source.id} is not a GeoJSON FeatureCollection")
        mapped_id = source.property_mapping.get("id")
        mapped_name = source.property_mapping.get("name")
        available_fields = {key for feature in body["features"] for key in (feature.get("properties") or {})}
        missing_fields = {field for field in (mapped_id, mapped_name) if field} - available_fields
        if body["features"] and missing_fields:
            raise ValueError(f"schema_changed: {source.id} is missing mapped fields {sorted(missing_fields)}")
        features: list[IntermediateFeature] = []
        for index, feature in enumerate(body["features"]):
            geometry = feature.get("geometry")
            properties = {**(feature.get("properties") or {}), **source.property_mapping.get("constants", {})}
            if not geometry:
                continue
            if mapped_id and properties.get(mapped_id) in (None, ""):
                continue
            if mapped_name and properties.get(mapped_name) in (None, ""):
                continue
            original_id = str(properties.get(mapped_id) if mapped_id else feature.get("id", properties.get("id", index)))
            features.append(IntermediateFeature(original_id, source.name, source.url, geometry, dict(properties), timestamp, {"rawFormat": "geojson", "sourceMetadata": {"sourceConfigId": source.id, "propertyMapping": source.property_mapping, "providerOptions": source.provider_options, "assignedDomains": list(source.domains), "attribution": source.attribution or source.name, "licenseUrl": source.license_url}, "confidence": source.confidence, "authorityTier": source.authority_tier}))
        return features

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
