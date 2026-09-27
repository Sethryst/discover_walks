"""Translate validated acquisition POIs into the Motherbird place contract."""
from __future__ import annotations

from .package_intelligence import POIRecord


def to_frontend_place(record: POIRecord) -> dict:
    """Map only evidence-backed fields; absent optional data stays absent/unknown."""
    place = {
        "id": record.record_id,
        "name": record.name,
        "category": record.canonical_category,
        "source": record.source_url,
        "publishingState": "candidate",
    }
    if record.latitude is not None and record.longitude is not None:
        place["coordinates"] = [record.longitude, record.latitude]
        place["latitude"] = record.latitude
        place["longitude"] = record.longitude
    if record.official_url:
        place["officialUrl"] = record.official_url
    for key, value in record.attributes.items():
        if value is not None and value != "":
            place[key] = value
    return place


def frontend_places_from_review_package(package: dict) -> list[dict]:
    """Convert accepted records only; review/rejection state is not publication."""
    return [to_frontend_place(POIRecord(**row["record"])) for row in package.get("records", [])]


def add_frontend_projection(package: dict) -> dict:
    projected = dict(package)
    projected["frontendSchema"] = "motherbird-place.v1"
    projected["places"] = frontend_places_from_review_package(package)
    return projected


def build_selected_frontend_package(package: dict, selected_record_ids, *, approval_reference=None) -> dict:
    """Build a publish candidate only after package approval and explicit IDs."""
    if package.get("status") != "APPROVED":
        raise ValueError("frontend publication requires an APPROVED review package")
    if not approval_reference:
        raise ValueError("frontend publication requires an approval reference")
    selected = set(selected_record_ids)
    available = {row["record"]["record_id"]: row for row in package.get("records", [])}
    missing = selected - set(available)
    if missing:
        raise ValueError("selected records are unavailable or not review-approved: " + ",".join(sorted(missing)))
    projected = {
        "schema": "motherbird-regional-package.v1",
        "packageId": package.get("packageId"),
        "approvalReference": approval_reference,
        "places": [to_frontend_place(POIRecord(**available[record_id]["record"])) for record_id in sorted(selected)],
    }
    return projected
