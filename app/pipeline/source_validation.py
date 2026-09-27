"""Approval-gated source validation work orders.

This module turns an approved research queue into explicit, reviewable records.
Evidence may be collected automatically, but a record is never promoted by
this module: an operator must check the gates and record the decision.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.pipeline.acceptance_policy import assess_candidate
from app.pipeline.registry import ProviderRegistry
from app.pipeline.source_config import SourceConfig


CHECKS = (
    ("endpointVerification", "Endpoint is exact, structured, reachable, and governed"),
    ("termsLicense", "Terms, license, attribution, and permitted acquisition reviewed"),
    ("geographicScope", "Records belong to the target region"),
    ("freeOrAccessible", "Event is free or has a documented public-access path"),
    ("fixture", "Redacted/raw fixture is saved with checksum"),
    ("mapping", "Required fields and adapter mapping are verified"),
    ("stableId", "Stable source identifier is present and collision-safe"),
    ("coordinates", "WGS84 coordinates or an approved address-geocoding rule verified"),
    ("refreshPolicy", "Freshness, expiry, and failure behavior are documented"),
    ("focusedTests", "Payload and adapter tests pass"),
)


def _candidate_key(candidate: dict[str, Any]) -> str:
    return str(candidate.get("candidateId") or hashlib.sha256(
        f"{candidate.get('regionId')}|{candidate.get('url')}|{candidate.get('category')}".encode()
    ).hexdigest()[:16])


def _adapter_plan(candidate: dict[str, Any]) -> dict[str, Any]:
    url = str(candidate.get("url", ""))
    category = str(candidate.get("category", "events"))
    if "api.nps.gov" in url:
        provider = "nps_events"
    elif any(token in url.lower() for token in ("rss", "feed", ".ics", "ical")):
        provider = "rss_ics_events"
    elif category == "events":
        provider = "jsonld_events"
    else:
        provider = "geojson_or_local_open_data"
    return {"provider": provider, "selectionReason": "Research hypothesis only; operator must verify the extraction contract."}


def build_work_order(queue_path: Path, workspace: Path, *, generated_at: str | None = None) -> dict[str, Any]:
    """Create approval-ready records from an explicit approved research queue."""
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    records = []
    for candidate in queue.get("candidates", []):
        checks = {name: {"checked": False, "evidence": None, "reviewer": None, "checkedAt": None}
                  for name, _ in CHECKS}
        record = {
            "validationId": f"sv-{_candidate_key(candidate)}",
            "candidateId": _candidate_key(candidate),
            "regionId": candidate.get("regionId"),
            "category": candidate.get("category"),
            "publisher": candidate.get("publisher"),
            "endpoint": candidate.get("url"),
            "researchDecision": candidate.get("decision", queue.get("decision", "APPROVE_FOR_PROVIDER_RESEARCH")),
            "adapterPlan": _adapter_plan(candidate),
            "checks": checks,
            "operatorDecision": {"status": "PENDING", "reviewer": None, "reason": None, "decidedAt": None},
            "nextActions": [description for _, description in CHECKS],
            "policy": "Evidence collection cannot activate, publish, or approve a source.",
        }
        records.append(record)
    return {
        "schemaVersion": 1,
        "kind": "source-validation-work-order",
        "generatedAt": generated_at,
        "queue": str(queue_path.relative_to(workspace)),
        "approvalRequired": True,
        "records": records,
    }


def validate_fixture_payload(source_dict: dict[str, Any], payload: Any) -> dict[str, Any]:
    """Exercise a registered adapter against a fixture without changing state."""
    source = SourceConfig.from_dict(source_dict)
    adapter = ProviderRegistry.create(source)
    timestamp = "2026-01-01T00:00:00Z"
    try:
        parser = getattr(adapter, "parse", None)
        if parser is None:
            return {"passed": False, "provider": source.provider, "reason": "adapter has no offline parse hook"}
        features = parser(payload, source, timestamp)
        return {"passed": True, "provider": source.provider, "records": len(features), "evidence": "fixture parsed by registered adapter"}
    except Exception as exc:  # validation output must retain a precise blocker
        return {"passed": False, "provider": source.provider, "reason": f"{type(exc).__name__}: {exc}"}


def assess_work_order_record(record: dict[str, Any]) -> dict[str, Any]:
    """Recompute stage from checked boxes; operatorDecision remains untouched."""
    checked = record.get("checks", {})
    gate_kwargs = {
        "endpoint_verified": bool(checked.get("endpointVerification", {}).get("checked")),
        "terms_verified": bool(checked.get("termsLicense", {}).get("checked")),
        "fixture_saved": bool(checked.get("fixture", {}).get("checked")),
        "mapping_verified": bool(checked.get("mapping", {}).get("checked")),
        "stable_id_verified": bool(checked.get("stableId", {}).get("checked")),
        "coordinates_verified": bool(checked.get("coordinates", {}).get("checked")),
        "refresh_verified": bool(checked.get("refreshPolicy", {}).get("checked")),
        "focused_tests_pass": bool(checked.get("focusedTests", {}).get("checked")),
    }
    result = assess_candidate(
        {"candidateId": record["candidateId"]},
        **gate_kwargs,
        active_region_config=bool(record.get("activeRegionConfig")),
        release_evidence=bool(record.get("releaseEvidence")),
    )
    result["operatorDecision"] = record.get("operatorDecision", {"status": "PENDING"})
    return result
