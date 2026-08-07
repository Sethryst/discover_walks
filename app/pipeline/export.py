"""Validated, reproducible public release-bundle writer."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.pipeline.contracts import validate_release


def build_release(region_id: str, pois: list[dict[str, Any]], warnings: list[dict[str, str]], producer_version: str, generated_at: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Create validated public content and companion producer metadata."""
    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    release = {"schemaVersion": 1, "regionId": region_id, "generatedAt": timestamp, "producer": {"name": "Gremlin Lab", "version": producer_version}, "pois": sorted(pois, key=lambda poi: poi["id"])}
    validate_release(release)
    manifest = {"schemaVersion": 1, "regionId": region_id, "generatedAt": timestamp, "producer": release["producer"], "sources": [{"name": "OpenStreetMap", "adapter": "openstreetmap-overpass", "license": "ODbL-1.0"}], "warnings": warnings, "checksums": {}}
    return release, manifest


def write_bundle(output_root: Path, release: dict[str, Any], manifest: dict[str, Any], dry_run: bool = False, supplemental: dict[str, Any] | None = None, civic: dict[str, dict[str, Any]] | None = None) -> Path:
    """Write a region bundle deterministically, including a checksum for every public file."""
    bundle_dir = output_root / release["regionId"]
    pois_bytes = _json_bytes(release)
    supplemental = supplemental or {}
    civic = civic or {}
    supplemental_bytes = {name: _json_bytes(value) for name, value in supplemental.items()}
    civic_bytes = {name: _json_bytes(value) for name, value in civic.items()}
    manifest["checksums"] = {
        "pois.json": _checksum(pois_bytes),
        **{f"supplemental/{name}": _checksum(value) for name, value in supplemental_bytes.items()},
        **{f"civic/{name}": _checksum(value) for name, value in civic_bytes.items()},
    }
    manifest_bytes = _json_bytes(manifest)
    if not dry_run:
        bundle_dir.mkdir(parents=True, exist_ok=True)
        (bundle_dir / "pois.json").write_bytes(pois_bytes)
        (bundle_dir / "producer-manifest.json").write_bytes(manifest_bytes)
        if supplemental_bytes:
            supplemental_dir = bundle_dir / "supplemental"
            supplemental_dir.mkdir(exist_ok=True)
            for name, content in supplemental_bytes.items():
                (supplemental_dir / name).write_bytes(content)
        if civic_bytes:
            civic_dir = bundle_dir / "civic"
            civic_dir.mkdir(exist_ok=True)
            for name, content in civic_bytes.items():
                (civic_dir / name).write_bytes(content)
    return bundle_dir


def _json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _checksum(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"
