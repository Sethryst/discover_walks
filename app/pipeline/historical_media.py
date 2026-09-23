"""Offline-first Wikimedia historical-media ingestion and release contracts."""
from __future__ import annotations

import hashlib
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

STATES = ("discovered", "candidate", "verified", "approved", "suppressed", "rejected")
PRECISIONS = ("exact", "address", "venue", "neighborhood", "city", "region", "unknown")
ALLOWED_LICENSES = {"Public domain", "CC0", "CC BY", "CC BY-SA"}
MEDIA_TYPES = {"audio", "image", "video"}


def stable_id(item: dict[str, Any]) -> str:
    identity = item.get("pageid") or item.get("title") or item.get("page_url")
    return "commons:" + hashlib.sha256(str(identity).encode()).hexdigest()[:20]


def validate_item(item: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if item.get("media_type") not in MEDIA_TYPES: errors.append("unsupported media type")
    if not item.get("page_url", "").startswith("https://commons.wikimedia.org/"): errors.append("invalid Commons page URL")
    if not item.get("file_url", "").startswith("https://"): errors.append("invalid media URL")
    if not set(item.get("license_templates", [])) & ALLOWED_LICENSES: errors.append("missing compatible machine-readable license")
    location = item.get("location") or {}
    if location.get("precision") not in PRECISIONS or location.get("precision") == "unknown": errors.append("missing sourced geographic evidence")
    if not location.get("statement") or not location.get("source_url"): errors.append("location statement/source required")
    for field in ("creator", "attribution", "retrieved_at"):
        if not item.get(field): errors.append(f"missing {field}")
    return errors


def normalize(item: dict[str, Any]) -> dict[str, Any]:
    record = dict(item)
    record["id"] = stable_id(record)
    record.setdefault("state", "discovered")
    record.setdefault("decision_history", [])
    record.setdefault("source_snapshot", {"page_url": record.get("page_url"), "retrieved_at": record.get("retrieved_at")})
    record["validation_errors"] = validate_item(record)
    if not record["validation_errors"] and record["state"] == "discovered": record["state"] = "candidate"
    return record


def app_index(records: Iterable[dict[str, Any]], version: str) -> dict[str, Any]:
    approved = []
    for record in sorted(records, key=lambda r: r["id"]):
        if record.get("state") != "approved": continue
        location = record["location"]
        approved.append({k: record[k] for k in ("id", "title", "date", "creator", "attribution", "page_url") if k in record} | {
            "media_type": record["media_type"], "media_url": record["file_url"], "location": location,
            "rights_status": "verified", "description": record.get("description", "")
        })
    return {"schema_version": 1, "version": version, "generated_at": datetime.now(timezone.utc).isoformat(), "records": approved}


def write_repository_layout(root: Path) -> None:
    for path in ("records/candidates.jsonl", "records/approved.jsonl", "records/suppressed.jsonl", "rights/evidence.jsonl", "locations/geocoded.jsonl", "releases"):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
    for path in ("media/audio", "media/images", "media/video", "derivatives/waveforms", "derivatives/thumbnails"):
        (root / path).mkdir(parents=True, exist_ok=True)


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in records), encoding="utf-8")


def record_vote(record: dict[str, Any], signal: str, weight: float = 1.0, actor: str = "anonymous") -> dict[str, Any]:
    if signal not in {"useful", "inaccurate-location", "broken-media", "rights-concern", "duplicate"}: raise ValueError("unknown moderation signal")
    event = {"signal": signal, "weight": max(0.0, min(weight, 3.0)), "actor": actor, "at": datetime.now(timezone.utc).isoformat()}
    record.setdefault("moderation", {"events": [], "status": "active"})["events"].append(event)
    serious = sum(e["weight"] for e in record["moderation"]["events"] if e["signal"] in {"rights-concern", "inaccurate-location", "broken-media"})
    if serious >= 5: record["state"] = "suppressed"; record["moderation"]["status"] = "review_required"
    return record
