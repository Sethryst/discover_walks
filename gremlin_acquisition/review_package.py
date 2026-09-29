"""Deterministic, review-only regional package artifacts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from .package_intelligence import RegionalNeed, deduplicate_pois, coverage_report
from .models import jsonable
from .quality import score_poi


def validate_review_package(payload: dict) -> list[str]:
    """Return schema errors without making publication decisions."""
    errors = []
    if payload.get('schema') != 'discover-walks-review-package.v1':
        errors.append('schema must be discover-walks-review-package.v1')
    geography = payload.get('geography')
    if not isinstance(geography, dict) or not geography.get('id') or not geography.get('query'):
        errors.append('geography requires id and query')
    if not isinstance(payload.get('requirements'), list) or not payload['requirements']:
        errors.append('requirements must be a non-empty list')
    coverage = payload.get('coverage')
    if not isinstance(coverage, dict) or not isinstance(coverage.get('requiredCategories'), list) or not isinstance(coverage.get('gaps'), list):
        errors.append('coverage requires requiredCategories and gaps lists')
    for key in ('records', 'rejected', 'duplicates', 'sourceEvidence'):
        if key not in payload:
            errors.append(f'missing {key}')
    for row in payload.get('records', []):
        if not isinstance(row, dict) or not isinstance(row.get('record'), dict) or not row['record'].get('record_id'):
            errors.append('accepted records require record.record_id')
    for row in payload.get('rejected', []):
        if not isinstance(row, dict) or not row.get('recordId') or not isinstance(row.get('quality'), dict):
            errors.append('rejected records require recordId and quality')
    return errors


def build_review_package(need: RegionalNeed, records, source_evidence=()):
    input_records = list(records)
    unique, duplicates = deduplicate_pois(input_records)
    accepted = []
    accepted_records = []
    rejected = []
    for record in unique:
        score = score_poi(record, need)
        row = {"record": jsonable(record), "quality": jsonable(score)}
        if score.total >= 0.6 and not score.rationale[0].startswith(("missing", "invalid", "partial", "latitude", "longitude", "geometry")):
            accepted.append(row)
            accepted_records.append(record)
        else:
            rejected.append({"recordId": record.record_id, "quality": jsonable(score), "reasons": list(score.rationale)})
    evidence_rows = list(source_evidence)
    payload = {
        "schema": "discover-walks-review-package.v1",
        "geography": {"id": need.geography_id, "query": need.geography_query, "bbox": need.bbox},
        "requirements": [jsonable(requirement) for requirement in need.requirements],
        # Coverage is a delivery claim, so it is calculated from records that
        # passed validation and quality gates. Keep candidate coverage beside
        # it so reviewers can distinguish a source gap from rejected evidence.
        "coverage": coverage_report(need, accepted_records),
        "candidateCoverage": coverage_report(need, unique),
        "records": accepted,
        "rejected": rejected,
        "duplicates": {key: sorted(values) for key, values in sorted(duplicates.items())},
        "sourceEvidence": sorted(row for row in evidence_rows if isinstance(row, str)),
        "sourceHealth": sorted((row for row in evidence_rows if isinstance(row, dict)), key=lambda row: (row.get('url', ''), row.get('provider', ''))),
        "sourceMetadata": sorted((row for row in evidence_rows if isinstance(row, dict) and ('licenseUrl' in row or 'authorityTier' in row)), key=lambda row: (row.get('url', ''), row.get('provider', ''))),
        "coverageMetrics": {
            "discoveredRecords": len(input_records),
            "deduplicatedRecords": len(unique),
            "acceptedRecords": len(accepted_records),
            "rejectedRecords": len(rejected),
            "duplicateGroups": len(duplicates),
            "duplicateRecords": sum(len(values) for values in duplicates.values()),
        },
    }
    from .frontend_package import frontend_places_from_review_package
    payload["frontendSchema"] = "motherbird-place.v1"
    payload["places"] = frontend_places_from_review_package({"records": accepted})
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload["packageId"] = hashlib.sha256(canonical.encode()).hexdigest()
    return payload


def write_review_package(payload: dict, directory: str | Path, *, status="READY FOR REVIEW", approval=None, publication=None):
    """Write an artifact with lifecycle metadata; writing never authorizes publication."""
    errors = validate_review_package(payload)
    if errors:
        raise ValueError('invalid review package: ' + '; '.join(errors))
    payload = dict(payload)
    payload["status"] = status
    payload["approval"] = approval
    payload["publication"] = publication
    destination = Path(directory) / f"{payload['packageId']}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return destination
