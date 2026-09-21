"""Versioned spatial release contract and publication gates."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


class ReleaseContractError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_release_candidate(release: dict[str, Any], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run conservative gates before a candidate can be exported."""
    errors: list[str] = []
    pois = release.get("pois")
    if not isinstance(pois, list):
        errors.append("pois must be an array")
        pois = []
    ids = [item.get("id") for item in pois if isinstance(item, dict)]
    if len(ids) != len(set(ids)):
        errors.append("duplicate POI ids")
    for index, poi in enumerate(pois):
        if not isinstance(poi, dict) or not poi.get("id") or not poi.get("name"):
            errors.append(f"poi[{index}] missing required id/name")
            continue
        if not (-90 <= float(poi.get("lat", 999)) <= 90 and -180 <= float(poi.get("lng", 999)) <= 180):
            errors.append(f"poi[{index}] has invalid coordinates")
    baseline = {"previousFeatureCount": len(previous.get("pois", []))} if previous else {}
    if previous and previous.get("pois") and not pois:
        errors.append("candidate contains no features while previous release was non-empty")
    return {"valid": not errors, "errors": errors, "metrics": {"featureCount": len(pois), **baseline}}


def build_artifact_manifest(*, region: str, package_version: str, package_schema_version: int,
                            created_at: str, artifact: Path, source_snapshot: str | None = None,
                            minimum_app_version: str | None = None) -> dict[str, Any]:
    return {
        "manifestVersion": 1, "region": region, "packageVersion": package_version,
        "packageSchemaVersion": package_schema_version, "createdAt": created_at,
        "sourceSnapshot": source_snapshot, "artifact": {"location": str(artifact), "size": artifact.stat().st_size, "sha256": sha256_file(artifact)},
        "minimumAppVersion": minimum_app_version,
    }
