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
        maximum = int(source.provider_options.get("maxRecords", 0)) or None
        truncated = False
        previous_signature: tuple[Any, ...] | None = None
        while True:
            parameters = {"where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "geojson", "resultOffset": str(offset), "resultRecordCount": "1000", **source.query_params}
            if source.credential():
                parameters["token"] = source.credential() or ""
            acquisition_url = str(source.provider_options.get("acquisitionUrl") or source.url)
            url = f"{acquisition_url.rstrip('/')}/query?{urlencode(parameters)}"
            body = self._request(url, source.id)
            batch = body.get("features", [])
            id_field = source.property_mapping.get("id")
            signature = tuple(
                feature.get("id")
                or (feature.get("properties") or {}).get(id_field)
                or (feature.get("properties") or {}).get("OBJECTID")
                or (feature.get("properties") or {}).get("objectid")
                or json.dumps(feature, sort_keys=True)
                for feature in batch[:5]
            )
            if batch and signature == previous_signature:
                raise ValueError(f"source_unavailable: {source.id} ignored ArcGIS pagination offsets")
            previous_signature = signature
            if maximum is not None and len(all_features) + len(batch) > maximum:
                batch = batch[: maximum - len(all_features)]
                truncated = True
            all_features.extend(batch)
            if maximum is not None and len(all_features) >= maximum:
                truncated = truncated or bool(body.get("exceededTransferLimit")) or len(batch) == 1000
                break
            if not batch or (len(batch) < 1000 and not body.get("exceededTransferLimit")):
                break
            offset += len(batch)
        raw = {"type": "FeatureCollection", "features": all_features}
        features = self.parse(raw, source, timestamp)
        if truncated:
            self.warnings.append({"code": "max_records_applied", "source": source.id, "detail": f"Configured ArcGIS limit of {maximum} records applied."})
        return features, raw

    def parse(self, raw: dict[str, Any], source: SourceConfig, timestamp: str) -> list[IntermediateFeature]:
        """Recreate intermediate features from a cached ArcGIS GeoJSON response."""
        if raw.get("type") != "FeatureCollection" or not isinstance(raw.get("features"), list):
            raise ValueError(f"schema_changed: {source.id} did not return a GeoJSON FeatureCollection")
        self.warnings: list[dict[str, str]] = []
        mapped_id = source.property_mapping.get("id")
        mapped_name = source.property_mapping.get("name")
        name_fallbacks = tuple(source.property_mapping.get("nameFallbacks", ()))
        available_fields = {
            key
            for feature in raw["features"]
            for key in (feature.get("properties") or {})
        }
        required_fields = {field for field in (mapped_id, mapped_name) if field}
        missing_fields = required_fields - available_fields
        if raw["features"] and missing_fields:
            raise ValueError(f"schema_changed: {source.id} is missing mapped fields {sorted(missing_fields)}")
        output: list[IntermediateFeature] = []
        for index, feature in enumerate(raw.get("features", [])):
            properties = feature.get("properties") or {}
            geometry = feature.get("geometry")
            if not geometry:
                self.warnings.append({"code": "unusable_source_record", "source": source.id, "detail": f"Feature {index} rejected: empty geometry."})
                continue
            if mapped_id and properties.get(mapped_id) in (None, ""):
                self.warnings.append({"code": "unusable_source_record", "source": source.id, "detail": f"Feature {index} rejected: empty mapped id field {mapped_id}."})
                continue
            if mapped_name and all(properties.get(field) in (None, "") for field in (mapped_name, *name_fallbacks)):
                self.warnings.append({"code": "unusable_source_record", "source": source.id, "detail": f"Feature {index} rejected: empty mapped name field {mapped_name}."})
                continue
            properties = {**properties, **source.property_mapping.get("constants", {})}
            identifier = str(properties.get(mapped_id) or feature.get("id", properties.get("OBJECTID", properties.get("objectid", index))))
            output.append(IntermediateFeature(identifier, source.name, source.url, geometry, dict(properties), timestamp, {"rawFormat": "arcgis", "sourceMetadata": {"sourceConfigId": source.id, "layerUrl": str(source.provider_options.get("acquisitionUrl") or source.url), "propertyMapping": source.property_mapping, "providerOptions": source.provider_options, "assignedDomains": list(source.domains), "attribution": source.attribution or source.name, "licenseUrl": source.license_url}, "confidence": source.confidence, "authorityTier": source.authority_tier}))
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
