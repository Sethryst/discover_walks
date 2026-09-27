"""Deterministic, review-only regional package artifacts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from .package_intelligence import RegionalNeed, deduplicate_pois, coverage_report
from .models import jsonable
from .quality import score_poi


def build_review_package(need: RegionalNeed, records, source_evidence=()):
    unique, duplicates = deduplicate_pois(records)
    accepted = []
    accepted_records = []
    rejected = []
    for record in unique:
        score = score_poi(record, need)
        row = {"record": jsonable(record), "quality": jsonable(score)}
        if score.total >= 0.6 and not score.rationale[0].startswith(("missing", "invalid", "partial", "latitude", "longitude")):
            accepted.append(row)
            accepted_records.append(record)
        else:
            rejected.append({"recordId": record.record_id, "quality": jsonable(score), "reasons": list(score.rationale)})
    payload = {
        "schema": "discover-walks-review-package.v1",
        "geography": {"id": need.geography_id, "query": need.geography_query},
        "requirements": [jsonable(requirement) for requirement in need.requirements],
        # Coverage is a delivery claim, so it is calculated from records that
        # passed validation and quality gates. Keep candidate coverage beside
        # it so reviewers can distinguish a source gap from rejected evidence.
        "coverage": coverage_report(need, accepted_records),
        "candidateCoverage": coverage_report(need, unique),
        "records": accepted,
        "rejected": rejected,
        "duplicates": {key: sorted(values) for key, values in sorted(duplicates.items())},
        "sourceEvidence": sorted(source_evidence),
    }
    from .frontend_package import frontend_places_from_review_package
    payload["frontendSchema"] = "motherbird-place.v1"
    payload["places"] = frontend_places_from_review_package({"records": accepted})
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload["packageId"] = hashlib.sha256(canonical.encode()).hexdigest()
    return payload


def write_review_package(payload: dict, directory: str | Path, *, status="READY FOR REVIEW", approval=None, publication=None):
    """Write an artifact with lifecycle metadata; writing never authorizes publication."""
    payload = dict(payload)
    payload["status"] = status
    payload["approval"] = approval
    payload["publication"] = publication
    destination = Path(directory) / f"{payload['packageId']}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return destination
