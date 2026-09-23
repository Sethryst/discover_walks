"""Offline-first Wikimedia historical-media ingestion and release contracts."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import re
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


def validate_media_bytes(record: dict[str, Any], payload: bytes, content_type: str | None) -> dict[str, Any]:
    """Return immutable media evidence; callers must not mirror until this passes."""
    expected = record.get("mime_type")
    actual = (content_type or "").split(";", 1)[0].lower()
    if expected and actual and expected != actual: raise ValueError(f"MIME mismatch: expected {expected}, got {actual}")
    if not payload: raise ValueError("empty media response")
    media_type = mimetypes.guess_type(record.get("file_url", ""))[0]
    if media_type and actual and media_type != actual and not (media_type.startswith("audio/") and actual == "application/ogg"):
        raise ValueError(f"URL/content MIME mismatch: {media_type} vs {actual}")
    return {"sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload), "mime_type": actual or expected or media_type}


def commons_text(value: Any) -> str:
    if isinstance(value, dict): value = value.get("value", "")
    return re.sub(r"<[^>]+>", "", str(value or "")).strip()


def commons_item(page: dict[str, Any], retrieved_at: str) -> dict[str, Any]:
    info = page.get("imageinfo", [{}])[0]
    meta = info.get("extmetadata", {})
    mime = "image/jpeg" if info.get("thumburl") else info.get("mime") or commons_text(meta.get("MimeType"))
    media_type = "audio" if (mime or "").startswith("audio/") else "video" if (mime or "").startswith("video/") else "image"
    license_name = commons_text(meta.get("LicenseShortName"))
    license_name = "CC BY-SA" if license_name.upper().startswith("CC BY-SA") else "CC BY" if license_name.upper().startswith("CC BY") else "Public domain" if license_name.lower().startswith("public domain") else license_name
    location_text = commons_text(meta.get("Location")) or commons_text(meta.get("ObjectLocation"))
    gps = page.get("coordinates", [{}])[0] if page.get("coordinates") else {}
    title = page.get("title", "")
    title_location = title.split(":", 1)[-1]
    if not location_text and re.search(r"\b\d{1,5}\s+[A-Za-z][A-Za-z .'-]+", title_location): location_text = title_location
    location = {"precision": "exact" if gps else "address" if location_text else "unknown", "statement": location_text, "source_url": f"https://commons.wikimedia.org/wiki/{quote(title.replace(' ', '_'))}"}
    if gps: location.update({"lat": gps.get("lat"), "lng": gps.get("lon")})
    return normalize({
        "pageid": page.get("pageid"), "title": page.get("title"), "page_url": location["source_url"],
        "file_url": info.get("thumburl") or info.get("url"), "original_file_url": info.get("url"), "media_type": media_type, "mime_type": mime,
        "creator": commons_text(meta.get("Artist")) or commons_text(meta.get("Credit")),
        "date": commons_text(meta.get("DateTimeOriginal")) or commons_text(meta.get("Date")),
        "license_templates": [license_name] if license_name else [], "attribution": commons_text(meta.get("Credit")) or commons_text(meta.get("Artist")),
        "source_institution": commons_text(meta.get("Institution")), "description": commons_text(meta.get("ImageDescription")),
        "retrieved_at": retrieved_at, "location": location,
        "source_snapshot": {"page": page, "retrieved_at": retrieved_at},
    })


def record_vote(record: dict[str, Any], signal: str, weight: float = 1.0, actor: str = "anonymous") -> dict[str, Any]:
    if signal not in {"useful", "inaccurate-location", "broken-media", "rights-concern", "duplicate"}: raise ValueError("unknown moderation signal")
    event = {"signal": signal, "weight": max(0.0, min(weight, 3.0)), "actor": actor, "at": datetime.now(timezone.utc).isoformat()}
    record.setdefault("moderation", {"events": [], "status": "active"})["events"].append(event)
    serious = sum(e["weight"] for e in record["moderation"]["events"] if e["signal"] in {"rights-concern", "inaccurate-location", "broken-media"})
    if serious >= 5: record["state"] = "suppressed"; record["moderation"]["status"] = "review_required"
    return record
