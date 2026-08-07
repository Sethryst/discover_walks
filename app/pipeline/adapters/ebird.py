"""eBird provider for privacy-safe, time-bounded wildlife discovery signals."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class EbirdProvider(SourceAdapter):
    """Aggregate public recent observations into stable-location seasonal signals."""

    endpoint = "https://api.ebird.org/v2/data/obs/geo/recent"

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        """Fetch recent hotspot sightings without retaining observer or checklist data."""
        token = source.credential()
        if not token:
            raise ValueError(f"eBird source {source.id} requires {source.credential_env}")
        options = source.provider_options
        centers = options.get("centers") or [{"lat": (region["bbox"][0] + region["bbox"][2]) / 2, "lng": (region["bbox"][1] + region["bbox"][3]) / 2}]
        raw_observations: list[dict[str, Any]] = []
        for center in centers:
            params = {"lat": center["lat"], "lng": center["lng"], "dist": options.get("distanceKm", 25), "back": options.get("days", 7), "hotspot": "true", "maxResults": 10000}
            raw_observations.extend(self._request(params, token, source.id))
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        south, west, north, east = region["bbox"]
        for observation in raw_observations:
            lat, lng = observation.get("lat"), observation.get("lng")
            if lat is None or lng is None or not (south <= lat <= north and west <= lng <= east):
                continue
            if observation.get("locId"):
                grouped[str(observation["locId"])].append(observation)
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features: list[IntermediateFeature] = []
        for location_id, observations in grouped.items():
            newest = max(observations, key=lambda item: item.get("obsDt", ""))
            species = sorted({item.get("comName") for item in observations if item.get("comName")})[:20]
            features.append(IntermediateFeature(location_id, source.name, source.url, {"type": "Point", "coordinates": [newest["lng"], newest["lat"]]}, {"name": newest.get("locName", location_id), "recentSpecies": species, "latestObservationAt": newest.get("obsDt"), "signalExpiresAt": (datetime.now(timezone.utc) + timedelta(days=int(options.get("days", 7)))).isoformat().replace("+00:00", "Z"), "signalType": "recent_hotspot_observations"}, timestamp, {"rawFormat": "ebird", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, {"requestCount": len(centers), "observationCount": len(raw_observations), "locationCount": len(features)}

    def _request(self, params: dict[str, Any], token: str, source_id: str) -> list[dict[str, Any]]:
        try:
            request = Request(f"{self.endpoint}?{urlencode(params)}", headers={"x-ebirdapitoken": token, "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"eBird acquisition failed for {source_id}: {exc}") from exc
