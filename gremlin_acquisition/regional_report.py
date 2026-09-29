"""Cross-region acquisition and human-review readiness summaries."""
from __future__ import annotations

from .rollout_gate import evaluate_review_package_gate


def build_regional_readiness_report(packages: list[dict], *, adapter_status='SUCCEEDED') -> dict:
    """Produce a deterministic comparison report from review package payloads."""
    regions = []
    for package in packages:
        geography = package.get('geography') or {}
        metrics = package.get('coverageMetrics') or {}
        gate = evaluate_review_package_gate(package, adapter_status=adapter_status)
        regions.append({
            'regionId': geography.get('id'), 'regionName': geography.get('query'),
            'discoveredRecords': metrics.get('discoveredRecords', 0),
            'acceptedRecords': metrics.get('acceptedRecords', len(package.get('records') or [])),
            'rejectedRecords': metrics.get('rejectedRecords', len(package.get('rejected') or [])),
            'duplicateRecords': metrics.get('duplicateRecords', 0),
            'coverageGaps': list((package.get('coverage') or {}).get('gaps') or []),
            'sourceCount': len(package.get('sourceMetadata') or package.get('sourceHealth') or []),
            'automatedReady': gate['automatedReady'], 'blockers': gate['blockers'],
        })
    regions.sort(key=lambda row: (row['regionId'] or '', row['regionName'] or ''))
    return {
        'schema': 'discover-walks-regional-readiness.v1',
        'regionCount': len(regions),
        'readyRegionCount': sum(row['automatedReady'] for row in regions),
        'regions': regions,
    }


def build_search_cycle_report(*, run_id: str, search_feedback: list[dict], packages: list[dict],
                             adapter_status='SUCCEEDED') -> dict:
    """Combine independent-search evidence with package readiness outcomes."""
    readiness = build_regional_readiness_report(packages, adapter_status=adapter_status)
    outcomes = {}
    for row in search_feedback:
        outcomes.setdefault(row.get('geography_id'), {'queries': 0, 'successful': 0, 'empty': 0, 'failed': 0})
        summary = outcomes[row.get('geography_id')]
        summary['queries'] += 1
        status = str(row.get('outcome', '')).upper()
        if status in {'SUCCEEDED', 'SUCCESS'}:
            summary['successful'] += 1
        elif status == 'EMPTY':
            summary['empty'] += 1
        else:
            summary['failed'] += 1
    for region in readiness['regions']:
        region['search'] = outcomes.get(region['regionId'], {'queries': 0, 'successful': 0, 'empty': 0, 'failed': 0})
    return {'schema': 'discover-walks-search-cycle.v1', 'runId': run_id,
            'searchQueryCount': len(search_feedback), 'readiness': readiness}
