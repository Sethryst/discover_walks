"""Deterministic offline pilot from replay evidence through audited release."""
from __future__ import annotations
import json
from datetime import date
from pathlib import Path
from .fallbacks import parse_ics, validate_event, apply_source_result
from .ledger import AcquisitionLedger
from .models import Geography, SourceRecord, SourceStatus
from .planner import AcquisitionPlanner
from .release import build_selected_package, rollback_exact
from .adapters import parse_geojson, acquire_with_fallback
from .package_intelligence import FeatureRequirement, RegionalNeed, coverage_report, discover_regions, needs_from_discoveries
from .review_package import build_review_package, write_review_package
from .source_search import SearchResult, candidate_source_configs, governed_source_proposals


class _ReplayGeography:
    """Deterministic geography fixture; production planning uses WKLS."""

    def resolve(self, query):
        return Geography(
            id="replay-portland",
            name="Portland",
            level="city",
            source_revision="replay-fixture",
        )

    def neighbors(self, geography):
        return []


class _DiscoveredReplayGeography:
    """Small deterministic resolver used to prove the discovery path.

    Production resolution remains WKLS-backed; this fixture deliberately
    exposes the same interface without pretending the replay place is real.
    """
    def resolve(self, query):
        if "new city" in str(query).casefold():
            return Geography("replay-new-city", "New City", "city", source_revision="replay-fixture")
        return Geography("", str(query), "ambiguous", source_revision="replay-fixture")

    def neighbors(self, geography):
        return []

def run_offline_pilot(fixture_dir, ledger_path, package_dir, audit_path):
    fixture=Path(fixture_dir); ledger=AcquisitionLedger(ledger_path)
    plans=AcquisitionPlanner(geo=_ReplayGeography(),ledger=ledger).plan(run_id='offline-pilot',root='Portland',max_batches=4,budget=20)
    raw=(fixture/'ics.json').read_text(encoding='utf-8'); data=json.loads(raw)
    events=[validate_event(e,date.today().isoformat()) for e in []]
    for item in data.get('events',[]):
        from .models import EventEvidence
        event=EventEvidence(item['title'],item['start'],item['official_url'],data['source'],item.get('stable_id'),latitude=item.get('latitude'),longitude=item.get('longitude'),parser='replay')
        events.append(validate_event(event,date.today().isoformat()))
    source=SourceRecord(data['source'],'replay.invalid',plans[-1].geography.id,events=events)
    ledger.transition(source,'VALIDATING','replay evidence received'); apply_source_result(source,events); ledger.transition(source,'READY FOR REVIEW','current replay event evidence validated'); ledger.upsert(source)
    # The offline fixture stands in for the trusted approval boundary only.
    source.approved_by='replay-moderator-contract'; ledger.transition(source,'APPROVED','trusted replay approval contract',actor=source.approved_by); ledger.upsert(source)
    selected=[e.stable_id for e in events if not e.expired and not e.warnings]
    report={'generatedAt':'offline-replay','rows':[{'sourceId':source.source_url,'status':'ready-for-promotion','events':[{'stableId':e.stable_id,'title':e.title,'startsAt':e.start,'officialUrl':e.official_url} for e in events if not e.expired and not e.warnings]}]}
    payload,path=build_selected_package(report,selected,package_dir)
    rollback=rollback_exact(payload['packageId'],payload['packageId'],audit_path)
    return {'plans':len(plans),'sourceStatus':source.status.value,'selectedEvents':len(selected),'packageId':payload['packageId'],'packagePath':str(path),'rollback':rollback}

def run_portland_poi_pilot(fixture_dir, ledger_path, package_dir):
    """Replay the declared Portland frontend POI requirements into review state."""
    fixture = Path(fixture_dir)
    ledger = AcquisitionLedger(ledger_path)
    geography = _ReplayGeography().resolve('Portland')
    requirements = tuple(FeatureRequirement(category) for category in ('park', 'trail', 'library', 'history'))
    need = RegionalNeed('Portland', geography.id, requirements, 'verified replay pilot')
    config = json.loads((fixture / 'pois.json').read_text(encoding='utf-8'))
    result = parse_geojson(config['document'], config['source'])
    report = ledger.ingest_pois('portland-poi-pilot', need, result)
    package = build_review_package(need, result.records, [config['source']['url']])
    ledger.record_review_package(package)
    path = write_review_package(package, package_dir)
    return {'packageId': package['packageId'], 'packagePath': str(path), 'coverage': report, 'recordCount': len(result.records)}


def run_discovered_region_pilot(fixture_dir, ledger_path, package_dir):
    """Exercise a newly discovered region without Portland-specific assumptions."""
    fixture = Path(fixture_dir)
    ledger = AcquisitionLedger(ledger_path)
    config = json.loads((fixture / 'discovered-region.json').read_text(encoding='utf-8'))
    geo = _DiscoveredReplayGeography()
    discoveries = discover_regions([config['query']], geo, known_ids=())
    for discovery in discoveries:
        ledger.record_region_discovery('discovered-region-pilot', discovery)
    needs = needs_from_discoveries(discoveries)
    if len(needs) != 1:
        raise ValueError('discovery replay did not produce exactly one new canonical region')
    need = needs[0]
    plans = AcquisitionPlanner(geo=geo, ledger=ledger).plan_discovered_regions(
        'discovered-region-pilot', discoveries, max_batches=1, budget=5
    )
    search_result = SearchResult(
        '"New City" official places', 'replay-search', 'ok',
        (config['source']['url'],), tuple(sorted({r.canonical_category for r in need.requirements})),
    )
    discovered_sources = candidate_source_configs([search_result])
    proposals = governed_source_proposals([search_result], need.geography_id)
    discovered_source = {**discovered_sources[0], 'propertyMapping': config['source']['propertyMapping']}
    failed_source = {**discovered_source, 'url': 'https://new-city.example/retired-places.geojson'}
    def transport(url):
        if url == discovered_source['url']:
            return json.dumps(config['document'])
        raise RuntimeError('source retired; use the official replacement')
    fallback = acquire_with_fallback([failed_source, discovered_source], transport)
    result = fallback.selected
    if result is None:
        raise ValueError('discovery replay fallback chain produced no selected source')
    report = ledger.ingest_fallback('discovered-region-pilot', need, fallback)
    package = build_review_package(need, result.records, [config['source']['url']])
    ledger.record_review_package(package)
    path = write_review_package(package, package_dir)
    return {
        'discoveryStatus': discoveries[0].status,
        'geographyId': need.geography_id,
        'plannedGeographies': [plan.geography.id for plan in plans],
        'packageId': package['packageId'],
        'packagePath': str(path),
        'coverage': report,
        'recordCount': len(result.records),
        'attemptCount': len(fallback.attempts),
        'fallbackReason': fallback.reason,
        'sourceProposals': proposals,
        'ledgerDiscoveries': len(ledger.region_discoveries),
    }
