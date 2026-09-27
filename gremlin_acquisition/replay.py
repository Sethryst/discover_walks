"""Deterministic offline pilot from replay evidence through audited release."""
from __future__ import annotations
import json
from datetime import date
from pathlib import Path
from .fallbacks import parse_ics, validate_event, apply_source_result
from .ledger import AcquisitionLedger
from .models import SourceRecord, SourceStatus
from .planner import AcquisitionPlanner
from .release import build_selected_package, rollback_exact

def run_offline_pilot(fixture_dir, ledger_path, package_dir, audit_path):
    fixture=Path(fixture_dir); ledger=AcquisitionLedger(ledger_path)
    plans=AcquisitionPlanner(ledger=ledger).plan(run_id='offline-pilot',root='Portland',max_batches=4,budget=20)
    raw=(fixture/'ics.json').read_text(encoding='utf-8'); data=json.loads(raw)
    events=[validate_event(e,date.today().isoformat()) for e in []]
    for item in data.get('events',[]):
        from .models import EventEvidence
        event=EventEvidence(item['title'],item['start'],item['official_url'],data['source'],item.get('stable_id'),latitude=item.get('latitude'),longitude=item.get('longitude'),parser='replay')
        events.append(validate_event(event,date.today().isoformat()))
    source=SourceRecord(data['source'],'replay.invalid',plans[-1].geography.id,events=events)
    apply_source_result(source,events); ledger.upsert(source)
    # The offline fixture stands in for the trusted approval boundary only.
    source.status=SourceStatus.APPROVED; source.approved_by='replay-moderator-contract'; ledger.upsert(source)
    selected=[e.stable_id for e in events if not e.expired and not e.warnings]
    report={'generatedAt':'offline-replay','rows':[{'sourceId':source.source_url,'status':'ready-for-promotion','events':[{'stableId':e.stable_id,'title':e.title,'startsAt':e.start,'officialUrl':e.official_url} for e in events if not e.expired and not e.warnings]}]}
    payload,path=build_selected_package(report,selected,package_dir)
    rollback=rollback_exact(payload['packageId'],payload['packageId'],audit_path)
    return {'plans':len(plans),'sourceStatus':source.status.value,'selectedEvents':len(selected),'packageId':payload['packageId'],'packagePath':str(path),'rollback':rollback}
