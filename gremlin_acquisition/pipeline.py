"""Explicit acquisition-to-review orchestration for approved source configs."""
from __future__ import annotations

from pathlib import Path
from .adapters import acquire_with_fallback
from .ledger import AcquisitionLedger
from .review_package import build_review_package, write_review_package


def acquire_review_package(run_id, need, source_configs, transport, ledger: AcquisitionLedger,
                           package_dir: str | Path, source_evidence=()):
    """Acquire a need through governed configs and return a review-only package.

    Source discovery and approval happen before this boundary. This function
    never approves a source, approves a package, or publishes records.
    """
    if not source_configs:
        raise ValueError('at least one governed source config is required')
    fallback = acquire_with_fallback(source_configs, transport)
    report = ledger.ingest_fallback(run_id, need, fallback)
    attempt_evidence = [
        f"{attempt.source_url} [{attempt.status}]" + (f": {'; '.join(attempt.errors)}" if attempt.errors else "")
        for attempt in fallback.attempts
    ]
    evidence = tuple(sorted(set(source_evidence) | set(attempt_evidence)))
    package = build_review_package(need, fallback.selected.records if fallback.selected else [], evidence)
    ledger.record_review_package(package)
    path = write_review_package(package, package_dir)
    return {'package': package, 'packagePath': str(path), 'coverage': report,
            'fallbackStatus': fallback.status, 'fallbackReason': fallback.reason,
            'attemptCount': len(fallback.attempts)}
