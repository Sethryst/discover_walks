"""eBird provider for privacy-safe, time-bounded wildlife discovery signals."""

from __future__ import annotations

import csv
import io
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


class EbirdHotspotsProvider(SourceAdapter):
    """Acquire durable named eBird hotspot destinations without observation data."""

    required_fields = {"locId", "locName", "lat", "lng"}

    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        """Fetch a regional hotspot CSV and retain stable public-place fields only."""
        token = source.credential()
        if not token:
            raise ValueError(f"eBird source {source.id} requires {source.credential_env}")
        try:
            request = Request(source.url, headers={"x-ebirdapitoken": token, "Accept": "text/csv", "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=75) as response:
                body = response.read().decode("utf-8-sig")
        except OSError as exc:
            raise RetryableGremlinError(f"eBird hotspot acquisition failed for {source.id}: {exc}") from exc
        raw = _parse_hotspot_csv(body)
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return self.parse(raw, source, timestamp, region), raw

    def parse(self, raw: dict[str, Any], source: SourceConfig, timestamp: str, region: dict[str, Any] | None = None) -> list[IntermediateFeature]:
        """Rebuild privacy-safe hotspot features from a cached CSV representation."""
        headers = set(raw.get("headers") or [])
        missing = self.required_fields - headers
        if missing:
            raise ValueError(f"schema_changed: {source.id} is missing hotspot CSV fields {sorted(missing)}")
        self.warnings: list[dict[str, str]] = []
        bbox = (region or {}).get("bbox")
        output: list[IntermediateFeature] = []
        excluded_patterns = tuple(str(value).casefold() for value in source.provider_options.get("excludeNamePatterns", ("private", "restricted")))
        for index, row in enumerate(raw.get("rows") or []):
            location_id = str(row.get("locId") or "").strip()
            name = str(row.get("locName") or "").removeprefix("**").strip()
            try:
                lat = float(row.get("lat", ""))
                lng = float(row.get("lng", ""))
            except (TypeError, ValueError):
                self.warnings.append({"code": "unusable_source_record", "source": source.id, "detail": f"Hotspot row {index} rejected: invalid coordinates."})
                continue
            if not location_id or not name:
                self.warnings.append({"code": "unusable_source_record", "source": source.id, "detail": f"Hotspot row {index} rejected: missing locId or locName."})
                continue
            if any(pattern in name.casefold() for pattern in excluded_patterns):
                self.warnings.append({"code": "restricted_destination_omitted", "source": source.id, "detail": f"Hotspot {location_id} omitted because its label is private or restricted."})
                continue
            if bbox:
                south, west, north, east = bbox
                if not (south <= lat <= north and west <= lng <= east):
                    continue
            properties = {
                "name": name,
                "locId": location_id,
                "countryCode": row.get("countryCode"),
                "subnational1Code": row.get("subnational1Code"),
                "subnational2Code": row.get("subnational2Code"),
                "latestObservationDate": row.get("latestObsDt"),
                "allTimeSpeciesCount": row.get("numSpeciesAllTime"),
                "hotspotType": "durable_ebird_hotspot",
            }
            metadata = {
                "rawFormat": "ebird_hotspot_csv",
                "sourceMetadata": {
                    "sourceConfigId": source.id,
                    "assignedDomains": list(source.domains),
                    "attribution": source.attribution or source.name,
                    "licenseUrl": source.license_url,
                },
                "confidence": source.confidence,
                "authorityTier": source.authority_tier,
            }
            output.append(IntermediateFeature(location_id, source.name, source.url, {"type": "Point", "coordinates": [lng, lat]}, properties, timestamp, metadata))
        return output


def _parse_hotspot_csv(body: str) -> dict[str, Any]:
    """Normalize both documented headerless eBird CSV and defensive headered fixtures."""
    rows = list(csv.reader(io.StringIO(body)))
    if rows and rows[0] and rows[0][0] == "locId":
        headers, values = rows[0], rows[1:]
    else:
        headers = ["locId", "countryCode", "subnational1Code", "subnational2Code", "lat", "lng", "locName", "latestObsDt", "numSpeciesAllTime", "supplementalCount"]
        values = rows
    return {"headers": headers, "rows": [dict(zip(headers, row)) for row in values]}
