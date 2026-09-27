"""Explicit, content-addressed release and rollback operations.

This module consumes a reviewed promotion report; it never fetches sources or
decides moderator approval. The report and selected IDs are inputs to an
auditable release action.
"""
from __future__ import annotations
import hashlib, json
from pathlib import Path

def build_selected_package(report, selected_event_ids, output_dir):
    selected=set(selected_event_ids); events=[]; rejected=[]
    for row in report.get('rows',[]):
        if row.get('status') != 'ready-for-promotion': continue
        for event in row.get('events',[]):
            eid=event.get('stableId') or event.get('id') or hashlib.sha256((row['sourceId']+'|'+event.get('title','')+'|'+event.get('startsAt','')).encode()).hexdigest()[:20]
            if eid in selected: events.append({'eventId':eid,'sourceId':row['sourceId'],'evidence':event})
    missing=selected-{e['eventId'] for e in events}
    if missing: rejected.append('unavailable or not promotion-ready event IDs: '+','.join(sorted(missing)))
    if not events: rejected.append('no explicitly selected events')
    if rejected: raise ValueError('; '.join(rejected))
    payload={'schemaVersion':1,'kind':'discover-walks-acquisition-package','sourceReportGeneratedAt':report.get('generatedAt'),'events':events}
    package_id=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    payload['packageId']=package_id
    destination=Path(output_dir)/f'{package_id}.json'; destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists() and destination.read_text(encoding='utf-8') != json.dumps(payload,sort_keys=True,indent=2)+'\n': raise ValueError('package hash collision')
    destination.write_text(json.dumps(payload,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    return payload, destination

def rollback_exact(package_id, active_package_id, history_path):
    if not package_id or package_id != active_package_id: raise ValueError('rollback requires the exact active package ID')
    row={'action':'rollback','packageId':package_id,'restored':'prior-approved-state','preserveLaterPromotions':True}
    with Path(history_path).open('a',encoding='utf-8') as f: f.write(json.dumps(row,sort_keys=True)+'\n')
    return row
