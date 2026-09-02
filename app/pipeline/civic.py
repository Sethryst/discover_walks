"""Governed civic-release artifacts, separate from geographic POIs."""

from __future__ import annotations

import json
import hashlib
import importlib
from pathlib import Path
from typing import Any
from datetime import datetime


ARTIFACTS = ("vote", "meetings", "volunteer", "organizers", "events")
NEWS_ARTIFACTS = {"vote", "meetings", "events"}
SOURCE_LINK_ARTIFACTS = {"eventSources": ("event-sources.json", "events", "Event calendar"), "volunteerSources": ("volunteer-sources.json", "volunteer", "Volunteer opportunities")}


def load_civic_artifacts(region_id: str, producer_version: str, generated_at: str, venue_pins: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
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
        automated_items = _automated_items(region_id, artifact, generated_at, venue_pins)
        if automated_items:
            items = _merge_items(items, automated_items)
        if not items and not _automated_provider_configured(region_id, artifact):
            continue
        if artifact in NEWS_ARTIFACTS:
            items = [{**item, "artifact_type": "temporal_event"} for item in items]
        _validate_items(artifact, items)
        artifacts[f"{artifact}.json"] = {
            "schemaVersion": 1,
            "regionId": region_id,
            **({"artifact_type": "temporal_event"} if artifact in NEWS_ARTIFACTS else {}),
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


def _automated_provider_configured(region_id: str, artifact: str) -> bool:
    registry_path = Path(__file__).parents[1] / "regions" / "civic-providers.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    provider = registry.get("providers", {}).get(region_id)
    return provider is not None and provider.get("artifact", "events") == artifact


def _automated_items(region_id: str, artifact: str, generated_at: str, venue_pins: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    registry_path = Path(__file__).parents[1] / "regions" / "civic-providers.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    provider = registry.get("providers", {}).get(region_id)
    if provider is None or provider.get("artifact", "events") != artifact:
        return []
    try:
        module_name = str(provider["module"])
        fetch_cards = getattr(importlib.import_module(module_name), "fetch_cards")
        now = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        if provider.get("venueJoin"):
            return fetch_cards(now, venue_pins or [])
        return fetch_cards(now)
    except Exception as exc:
        # Scheduled production must report a failed civic acquisition rather
        # than quietly replacing useful event data with an empty artifact.
        raise RuntimeError(f"{provider.get('label', region_id)} civic event refresh failed: {exc}") from exc


def _merge_items(reviewed: list[dict[str, Any]], automated: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retain reviewed cards and add source-derived records without ID collisions."""
    result = {item["id"]: item for item in automated}
    result.update({item["id"]: item for item in reviewed})
    return list(result.values())


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
        required.add("artifact_type")
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
    civic_bytes = {name: _json_bytes(payload) for name, payload in civic.items()}
    checksums = dict(manifest.get("checksums", {}))
    checksums.update({f"civic/{name}": _checksum(content) for name, content in civic_bytes.items()})
    for name in (f"{artifact}.json" for artifact in NEWS_ARTIFACTS):
        if name not in civic:
            checksums.pop(f"civic/{name}", None)
    manifest["checksums"] = checksums
    capabilities = dict(manifest.get("capabilities", {}))
    notice_count = sum(len(civic.get(f"{artifact}.json", {}).get("items", [])) for artifact in NEWS_ARTIFACTS)
    capabilities["news"] = "furnished" if notice_count else ("empty-by-design" if civic else "none")
    manifest["capabilities"] = capabilities
    if dry_run:
        return
    civic_dir = bundle_dir / "civic"
    civic_dir.mkdir(exist_ok=True)
    for name in (f"{artifact}.json" for artifact in NEWS_ARTIFACTS):
        if name not in civic:
            (civic_dir / name).unlink(missing_ok=True)
    for name, content in civic_bytes.items():
        (civic_dir / name).write_bytes(content)
    manifest_path.write_bytes(_json_bytes(manifest))


def mark_civic_news_stale(bundle_dir: Path) -> None:
    """Preserve the last good civic files while exposing refresh failure to consumers."""
    manifest_path = bundle_dir / "producer-manifest.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    capabilities = dict(manifest.get("capabilities", {}))
    capabilities["news"] = "stale"
    manifest["capabilities"] = capabilities
    manifest_path.write_bytes(_json_bytes(manifest))


def _json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _checksum(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"
