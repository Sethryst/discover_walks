"""Explicit, content-addressed release and rollback operations.

This module consumes a reviewed promotion report; it never fetches sources or
decides moderator approval. The report and selected IDs are inputs to an
auditable release action.
"""
from __future__ import annotations
import hashlib, json
from pathlib import Path
import argparse

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

def main(argv=None):
    parser=argparse.ArgumentParser(description='Explicit acquisition package release')
    parser.add_argument('--report',type=Path); parser.add_argument('--selected-event-id',action='append',default=[])
    parser.add_argument('--output-dir',type=Path,default=Path('promotion-artifacts/packages'))
    parser.add_argument('--action',choices=('validate','publish','rollback'),required=True)
    parser.add_argument('--package-id'); parser.add_argument('--active-package-id'); parser.add_argument('--audit',type=Path,default=Path('promotion-artifacts/audit.jsonl'))
    args=parser.parse_args(argv)
    if args.action in ('validate','publish'):
        if not args.report: parser.error('--report is required')
        payload,path=build_selected_package(json.loads(args.report.read_text(encoding='utf-8')),args.selected_event_id,args.output_dir)
        print(json.dumps({'action':args.action,'packageId':payload['packageId'],'path':str(path)},sort_keys=True))
    else:
        if not args.package_id or not args.active_package_id: parser.error('rollback requires exact package IDs')
        print(json.dumps(rollback_exact(args.package_id,args.active_package_id,args.audit),sort_keys=True))

if __name__ == '__main__': main()
