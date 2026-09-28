"""Deterministic regional rollout readiness policy.

This module deliberately keeps automated evidence separate from the human
advancement decision. A region can be technically ready without being moved
forward until a trusted operator records that decision.
"""
from __future__ import annotations


def evaluate_region_gate(*, region_id, region_name, adapter_status, accepted_count,
                         coverage_gaps, duplicate_count=0, validation_errors=None,
                         human_advanced=False):
    """Return an explainable, JSON-friendly readiness record."""
    checks = {
        "adapter": adapter_status == "SUCCEEDED",
        "package": accepted_count > 0,
        "coverage": not list(coverage_gaps or []),
        "dedupe": duplicate_count == 0,
        "validation": not list(validation_errors or []),
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
