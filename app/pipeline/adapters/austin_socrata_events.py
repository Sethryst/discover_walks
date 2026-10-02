"""Bounded adapter for the City of Austin ACCD Socrata event listing."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class AustinSocrataEventsProvider(SourceAdapter):
    """Parse only the known ACCD fields and preserve source-local wall time."""

    def acquire(self, source: SourceConfig, region: dict):
        try:
            with urlopen(Request(source.url, headers={"Accept": "application/json", "User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
                rows = json.loads(response.read())
                last_modified = response.headers.get("Last-Modified")
        except OSError as exc:
            raise RetryableGremlinError(f"Austin Socrata acquisition failed for {source.id}") from exc
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        point = source.provider_options.get("defaultCoordinates", [-97.7431, 30.2672])
        features = []
        for row in rows[:int(source.provider_options.get("limit", 250))]:
            title = (row.get("event_name") or "").strip()
            start = row.get("arrive_date")
            if not title or not start:
                continue
            location = row.get("location") or ""
            official_url = row.get("website") or source.url
            event_id = sha256(f"{source.id}|{title}|{start}|{location}".encode()).hexdigest()[:20]
            props = {"name": title, "startsAt": start, "endsAt": row.get("depart_date"), "officialUrl": official_url, "location": location, "timeSemantics": "unspecified-wall-time", "publishable": False, "sourceRecord": row}
            features.append(IntermediateFeature(event_id, source.name, source.url, {"type": "Point", "coordinates": point}, props, stamp, {"rawFormat": "socrata-json", "sourceMetadata": {"sourceConfigId": source.id, "lastModified": last_modified, "datasetId": "p9ma-z6y9"}, "confidence": source.confidence}))
        return features, {"format": "austin-socrata-json", "recordCount": len(rows), "acceptedCount": len(features), "timeSemantics": "unspecified-wall-time", "datasetId": "p9ma-z6y9"}
