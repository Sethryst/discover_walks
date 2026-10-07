"""iNaturalist observations provider for bounded, reviewable biodiversity signals."""

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


class INaturalistProvider(SourceAdapter):
    """Acquire public observations without retaining observer identity or photos."""

    endpoint = "https://api.inaturalist.org/v1/observations"

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        bbox = region.get("bbox")
        if not bbox:
            raise ValueError(f"iNaturalist source {source.id} requires a region bbox")
        params = {"swlat": bbox[0], "swlng": bbox[1], "nelat": bbox[2], "nelng": bbox[3], "per_page": min(int(source.provider_options.get("limit", 200)), 200), "order_by": "observed_on", "order": "desc", "quality_grade": source.provider_options.get("qualityGrade", "research")}
        raw = self._request(params, source.id)
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return self.parse(raw, source, timestamp, region), {"observationCount": len(raw.get("results", []))}

    def parse(self, raw: dict[str, Any], source: SourceConfig, timestamp: str, region: dict[str, Any] | None = None) -> list[IntermediateFeature]:
        bbox = (region or {}).get("bbox")
        output: list[IntermediateFeature] = []
        for observation in raw.get("results", []):
            taxon = observation.get("taxon") or {}
            coords = ((observation.get("geojson") or {}).get("coordinates") or [])
            if len(coords) < 2:
                continue
            lng, lat = float(coords[0]), float(coords[1])
            if bbox and not (bbox[0] <= lat <= bbox[2] and bbox[1] <= lng <= bbox[3]):
                continue
            obs_id = str(observation.get("id") or "").strip()
            name = taxon.get("preferred_common_name") or taxon.get("name")
            if not obs_id or not name:
                continue
            properties = {
                "name": name,
                "scientificName": taxon.get("name"),
                "observedAt": observation.get("observed_on"),
                "qualityGrade": observation.get("quality_grade"),
                "signalType": "public_species_observation",
                "recordUrl": f"https://www.inaturalist.org/observations/{obs_id}",
            }
            metadata = {"rawFormat": "inaturalist-observations-json", "sourceMetadata": {"sourceConfigId": source.id, "licenseUrl": source.license_url, "attribution": source.attribution or source.name}, "confidence": source.confidence, "authorityTier": source.authority_tier}
            output.append(IntermediateFeature(f"inaturalist:{obs_id}", source.name, source.url, {"type": "Point", "coordinates": [lng, lat]}, properties, timestamp, metadata))
        return output

    def _request(self, params: dict[str, Any], source_id: str) -> dict[str, Any]:
        try:
            request = Request(f"{self.endpoint}?{urlencode(params)}", headers={"Accept": "application/json", "User-Agent": "Gremlin-Lab/1.0 (public biodiversity acquisition)"})
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"iNaturalist acquisition failed for {source_id}: {exc}") from exc
