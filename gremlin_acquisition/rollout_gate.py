"""Deterministic regional rollout readiness policy.

This module deliberately keeps automated evidence separate from the human
advancement decision. A region can be technically ready without being moved
forward until a trusted operator records that decision.
"""
from __future__ import annotations


def evaluate_region_gate(*, region_id, region_name, adapter_status, accepted_count,
                         coverage_gaps, duplicate_count=0, validation_errors=None,
                         human_advanced=False, quality_scores=(), min_quality=0.6,
                         source_metadata=()):
    """Return an explainable, JSON-friendly readiness record."""
    scores = [float(score.get('total')) if isinstance(score, dict) else float(getattr(score, 'total', score))
              for score in (quality_scores or ())]
    metadata = list(source_metadata or ())
    checks = {
        "adapter": adapter_status == "SUCCEEDED",
        "package": accepted_count > 0,
        "coverage": not list(coverage_gaps or []),
        "dedupe": duplicate_count == 0,
        "validation": not list(validation_errors or []),
        "quality": not scores or min(scores) >= min_quality,
        "sourceEvidence": not metadata or all(
            row.get('licenseUrl') and str(row.get('authorityTier', 'unknown')).casefold() != 'unknown'
            for row in metadata
        ),
    }
    automated_ready = all(checks.values())
    return {
        "regionId": region_id,
        "regionName": region_name,
        "checks": checks,
        "automatedReady": automated_ready,
        "humanAdvanced": bool(human_advanced),
        "canAdvance": automated_ready and bool(human_advanced),
        "blockers": [name for name, passed in checks.items() if not passed]
        + ([] if automated_ready and human_advanced else ["human_readiness"]),
    }


def evaluate_review_package_gate(package: dict, *, adapter_status: str = "SUCCEEDED",
                                 human_advanced: bool = False, min_quality: float = 0.6) -> dict:
    """Evaluate a review artifact without requiring callers to rebuild metrics."""
    geography = package.get('geography') or {}
    records = package.get('records') or []
    scores = [row.get('quality', {}) for row in records]
    metadata = package.get('sourceMetadata') or []
    return evaluate_region_gate(
        region_id=geography.get('id'), region_name=geography.get('query'),
        adapter_status=adapter_status, accepted_count=len(records),
        coverage_gaps=(package.get('coverage') or {}).get('gaps', []),
        duplicate_count=sum(len(values) for values in (package.get('duplicates') or {}).values()),
        validation_errors=[reason for row in package.get('rejected', []) for reason in row.get('reasons', [])],
        quality_scores=scores, min_quality=min_quality,
        source_metadata=metadata, human_advanced=human_advanced,
    )
