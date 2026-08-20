"""Configuration-driven normalization and verification for geographic layers."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from app.pipeline.source_config import SourceConfig


def build_boundary_layer(
    raw: dict[str, Any],
    source: SourceConfig,
    region_id: str,
    generated_at: str,
    cache_path: Path,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Validate and normalize one Polygon/MultiPolygon FeatureCollection."""
    if raw.get("type") != "FeatureCollection" or not isinstance(raw.get("features"), list):
        raise ValueError(f"{source.id} is not a GeoJSON FeatureCollection")
    id_field = source.property_mapping["id"]
    name_field = source.property_mapping["name"]
    included = tuple(source.property_mapping.get("include", ()))
    features: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for index, feature in enumerate(raw["features"]):
        geometry = feature.get("geometry")
        if not geometry or not geometry.get("coordinates"):
            warnings.append({"code": "empty_geometry", "source": source.id, "detail": f"Dropped feature {index} with empty geometry."})
            continue
        geometry_type = geometry.get("type")
        if geometry_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"{source.id} feature {index} has unsupported boundary geometry {geometry_type!r}")
        _validate_wgs84(geometry.get("coordinates"), source.id, index)
        source_properties = feature.get("properties") or {}
        stable_id = str(source_properties.get(id_field, "")).strip()
        name = str(source_properties.get(name_field, "")).strip()
        if not stable_id or not name:
            raise ValueError(f"{source.id} feature {index} lacks mapped id/name properties")
        if stable_id in seen_ids:
            raise ValueError(f"{source.id} contains duplicate stable id {stable_id!r}")
        seen_ids.add(stable_id)
        properties = {"id": stable_id, "name": name}
        properties.update({key: source_properties[key] for key in included if source_properties.get(key) is not None})
        features.append({"type": "Feature", "id": stable_id, "properties": properties, "geometry": geometry})
    if not features:
        raise ValueError(f"{source.id} produced no valid boundary features")
    features.sort(key=lambda item: item["id"])
    artifact = {
        "type": "FeatureCollection",
        "metadata": {
            "schemaVersion": 1,
            "regionId": region_id,
            "layerRole": source.layer_role,
            "generatedAt": generated_at,
            "attribution": source.attribution or source.name,
            "source": {
                "id": source.id,
                "name": source.name,
                "url": source.url,
                "licenseUrl": source.license_url,
                "cacheKey": str(cache_path),
            },
        },
        "features": features,
    }
    return artifact, warnings


def verify_geographic_artifacts(bundle_dir: Path, manifest: dict[str, Any]) -> dict[str, int]:
    """Verify declared geography files, feature counts, JSON, and SHA-256 checksums."""
    verified: dict[str, int] = {}
    for layer in manifest.get("geography", []):
        relative_path = layer["filename"]
        path = bundle_dir / relative_path
        if not path.exists():
            raise ValueError(f"Missing geographic artifact: {relative_path}")
        payload = path.read_bytes()
        expected = manifest.get("checksums", {}).get(relative_path)
        actual = f"sha256:{hashlib.sha256(payload).hexdigest()}"
        if expected != actual:
            raise ValueError(f"Geographic artifact checksum mismatch: {relative_path}")
        document = json.loads(payload)
        features = document.get("features") if document.get("type") == "FeatureCollection" else None
        if not isinstance(features, list) or not features:
            raise ValueError(f"Geographic artifact has no features: {relative_path}")
        if len(features) != layer.get("featureCount"):
            raise ValueError(f"Geographic artifact feature count mismatch: {relative_path}")
        verified[relative_path] = len(features)
    return verified


def _validate_wgs84(coordinates: Any, source_id: str, feature_index: int) -> None:
    positions = list(_positions(coordinates))
    if not positions:
        raise ValueError(f"{source_id} feature {feature_index} has empty coordinates")
    for lng, lat in positions:
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError(f"{source_id} feature {feature_index} is outside WGS84 limits")


def _positions(value: Any) -> Iterable[tuple[float, float]]:
    if isinstance(value, (list, tuple)) and len(value) >= 2 and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value[:2]):
        yield float(value[0]), float(value[1])
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _positions(item)
