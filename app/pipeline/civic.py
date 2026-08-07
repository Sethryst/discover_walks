"""Governed civic-release artifacts, separate from geographic POIs."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any


ARTIFACTS = ("vote", "meetings", "volunteer", "organizers", "events")
SOURCE_LINK_ARTIFACTS = {"eventSources": ("event-sources.json", "events", "Event calendar"), "volunteerSources": ("volunteer-sources.json", "volunteer", "Volunteer opportunities")}


def load_civic_artifacts(region_id: str, producer_version: str, generated_at: str) -> dict[str, dict[str, Any]]:
    """Load reviewed official civic facts; omit artifact types with no approved facts."""
    source = Path(__file__).parents[1] / "regions" / "civic" / f"{region_id}.json"
    if not source.exists():
        return {}
    document = json.loads(source.read_text(encoding="utf-8"))
    if document.get("regionId") != region_id:
        raise ValueError(f"Civic definition region mismatch: {source}")
    artifacts: dict[str, dict[str, Any]] = {}
    for artifact in ARTIFACTS:
        items = document.get(artifact, [])
        if not items:
            continue
        _validate_items(artifact, items)
        artifacts[f"{artifact}.json"] = {
            "schemaVersion": 1,
            "regionId": region_id,
            "generatedAt": generated_at,
            "producer": {"name": "Gremlin Lab", "version": producer_version},
            "items": sorted(items, key=lambda item: (item.get("date", ""), item.get("name", item.get("title", "")), item["id"])),
        }
    for field, (filename, registry_field, label) in SOURCE_LINK_ARTIFACTS.items():
        item = _source_link(region_id, field, registry_field, label)
        if item:
            artifacts[filename] = {
                "schemaVersion": 1,
                "regionId": region_id,
                "generatedAt": generated_at,
                "producer": {"name": "Gremlin Lab", "version": producer_version},
                "items": [item],
            }
    return artifacts


def _source_link(region_id: str, field: str, registry_field: str, label: str) -> dict[str, Any] | None:
    """Expose a reviewed directory link without representing it as a dated event or shift."""
    registry_path = Path(__file__).parents[1] / "regions" / "civic-source-priority.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    url = registry.get("regions", {}).get(region_id, {}).get(registry_field)
    if not isinstance(url, str) or not url.startswith("https://"):
        return None
    return {
        "id": f"{region_id}:{field}",
        "title": label,
        "summary": f"Browse the linked {label.lower()} for current listings. This is a source link, not a claim about a specific scheduled item.",
        "officialUrl": url,
        "source": {"name": "Gremlin Lab reviewed source link", "url": url, "reviewStatus": "source_link"},
    }


def _validate_items(artifact: str, items: Any) -> None:
    if not isinstance(items, list):
        raise ValueError(f"Civic {artifact} must be a list")
    required = {"id", "name", "summary", "officialUrl", "source"} if artifact == "organizers" else {"id", "title", "summary", "officialUrl", "source"}
    if artifact in {"vote", "meetings", "events"}:
        required.add("date")
    if artifact == "events":
        required.add("locationLabel")
    if artifact == "volunteer":
        required.add("timeCommitment")
    for item in items:
        if not isinstance(item, dict) or not required.issubset(item):
            raise ValueError(f"Civic {artifact} item lacks required public fields")
        if not str(item["officialUrl"]).startswith("https://"):
            raise ValueError(f"Civic {artifact} officialUrl must be https")
        source = item["source"]
        if not isinstance(source, dict) or not str(source.get("url", "")).startswith("https://"):
            raise ValueError(f"Civic {artifact} item lacks official source provenance")
        _validate_context(item, artifact)


def _validate_context(item: dict[str, Any], artifact: str) -> None:
    """Keep friction, organizer, and participation context explicit and non-personal."""
    organizer = item.get("organizer")
    if organizer is not None and (not isinstance(organizer, dict) or not {"id", "name"}.issubset(organizer)):
        raise ValueError(f"Civic {artifact} organizer needs stable id and name")
    barriers = item.get("barriers")
    if barriers is not None:
        if not isinstance(barriers, dict):
            raise ValueError(f"Civic {artifact} barriers must be an object")
        for flag in ("weekdayDaytime", "transitAccessible", "childcareProvided"):
            if flag in barriers and not isinstance(barriers[flag], bool):
                raise ValueError(f"Civic {artifact} barrier {flag} must be boolean")
    structure = item.get("structure")
    if structure is not None and (not isinstance(structure, dict) or any(not isinstance(value, (str, int, float, bool)) for value in structure.values())):
        raise ValueError(f"Civic {artifact} structure must contain only public scalar facts")
    participation = item.get("participation")
    if participation is not None and (not isinstance(participation, dict) or not {"whatYouWillDo", "timeCommitment", "riskClarity"}.issubset(participation)):
        raise ValueError(f"Civic {artifact} participation requires task, time, and risk clarity")


def attach_civic_artifacts(bundle_dir: Path, civic: dict[str, dict[str, Any]], dry_run: bool = False) -> None:
    """Add civic files to an existing validated POI release without rebuilding sources."""
    manifest_path = bundle_dir / "producer-manifest.json"
    if not manifest_path.exists() or not (bundle_dir / "pois.json").exists():
        raise FileNotFoundError(f"No existing release bundle at {bundle_dir}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not civic:
        return
    civic_bytes = {name: _json_bytes(payload) for name, payload in civic.items()}
    checksums = dict(manifest.get("checksums", {}))
    checksums.update({f"civic/{name}": _checksum(content) for name, content in civic_bytes.items()})
    manifest["checksums"] = checksums
    if dry_run:
        return
    civic_dir = bundle_dir / "civic"
    civic_dir.mkdir(exist_ok=True)
    for name, content in civic_bytes.items():
        (civic_dir / name).write_bytes(content)
    manifest_path.write_bytes(_json_bytes(manifest))


def _json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _checksum(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"
