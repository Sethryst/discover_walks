"""Deterministic validation gates for approved Scout candidates.

This module deliberately keeps candidate approval separate from activation.  A
candidate is LANDed only when the production region config and a generated
release both contain evidence for the same source identity or endpoint.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from app.pipeline.acceptance_policy import assess_candidate


def validate_queue(workspace: Path, queue_path: Path) -> dict[str, Any]:
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    candidates = queue["candidates"]
    result: list[dict[str, Any]] = []
    for candidate in candidates:
        region_id = candidate["regionId"]
        region_path = workspace / "app" / "regions" / f"{region_id}.json"
        region = json.loads(region_path.read_text(encoding="utf-8")) if region_path.exists() else {}
        active_sources = [s for s in region.get("sources", []) if s.get("status", "active") == "active"]
        matched = [s for s in active_sources if s.get("id") == candidate["candidateId"] or s.get("url") == candidate["url"]]
        release_path = workspace / "releases" / region_id / "pois.json"
        release_text = release_path.read_text(encoding="utf-8") if release_path.exists() else ""
        release_evidence = candidate["url"] in release_text or candidate["candidateId"] in release_text
        blockers: list[str] = []
        if not matched:
            blockers.append("no matching active source in app/regions configuration")
        if not release_evidence:
            blockers.append("no generated release evidence for the candidate endpoint or identity")
        if not candidate["url"].startswith("https://"):
            blockers.append("endpoint is not HTTPS")
        status = "LANDED" if matched and release_evidence else ("PARTIAL" if release_evidence else "BLOCKED")
        result.append({
            "candidateId": candidate["candidateId"], "regionId": region_id,
            "status": status, "endpoint": candidate["url"],
            "activeRegionConfig": bool(matched), "releaseEvidence": release_evidence,
            "blockers": blockers,
            "requiredEvidence": ["endpoint verification", "terms/license", "fixture", "field mapping", "stable ID", "WGS84 coordinates", "refresh policy", "focused tests", "active region config", "generated release evidence"],
            "acceptance": assess_candidate(candidate, active_region_config=bool(matched), release_evidence=release_evidence),
        })
    counts = {key: sum(item["status"] == key for item in result) for key in ("LANDED", "PARTIAL", "BLOCKED")}
    return {"schemaVersion": 1, "kind": "candidate-lifecycle-validation", "source": str(queue_path.relative_to(workspace)), "approved": len(result), "summary": counts, "candidates": result}
