"""OpenStreetMap Overpass provider for configuration-driven, tag-filtered acquisition."""

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


class OsmOverpassProvider(SourceAdapter):
    """Acquire OSM features using an approved Overpass query template and preserve tags."""

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        """Run the configured tag query inside region bounds and create lossless features."""
        south, west, north, east = region["bbox"]
        selector = source.provider_options.get("selector")
        if not selector:
            raise ValueError(f"OSM source {source.id} requires providerOptions.selector")
        output = "out geom tags;" if source.provider_options.get("fullGeometry") else "out center tags;"
        query = f"[out:json][timeout:90];nwr{selector}({south},{west},{north},{east});{output}"
        try:
            request = Request(source.url, data=urlencode({"data": query}).encode("utf-8"), headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=120) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"OSM acquisition failed for {source.id}: {exc}") from exc
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return self.parse(raw, source, timestamp), raw

    def parse(self, raw: dict[str, Any], source: SourceConfig, timestamp: str) -> list[IntermediateFeature]:
        """Convert a saved Overpass response into intermediate features for offline replay."""
        features: list[IntermediateFeature] = []
        for element in raw.get("elements", []):
            geometry = _geometry(element)
            if geometry is None:
                continue
            features.append(IntermediateFeature(str(element["id"]), source.name, source.url, geometry, dict(element.get("tags", {})), timestamp, {"rawFormat": "osm", "sourceMetadata": {"sourceConfigId": source.id, "osmType": element["type"]}, "confidence": source.confidence}))
        return features


def _geometry(element: dict[str, Any]) -> dict[str, Any] | None:
    if "lat" in element and "lon" in element:
        return {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
    center = element.get("center")
    if center:
        return {"type": "Point", "coordinates": [center["lon"], center["lat"]]}
    if element.get("type") == "way" and isinstance(element.get("geometry"), list):
        coordinates = [[point["lon"], point["lat"]] for point in element["geometry"] if "lon" in point and "lat" in point]
        if len(coordinates) >= 2:
            return {"type": "LineString", "coordinates": coordinates}
    return None
