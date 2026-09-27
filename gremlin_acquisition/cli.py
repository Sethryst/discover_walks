"""Offline-first acquisition replay and ledger inspection CLI."""
import argparse, json
from datetime import date
from pathlib import Path
from .geo import WklsGeography
from .ledger import AcquisitionLedger
from .planner import AcquisitionPlanner
from .kpi import summarize
from .fallbacks import parse_ics, validate_event, apply_source_result
from .models import SourceRecord
from .package_intelligence import need_from_region_config
from .adapters import acquire
from .review_package import build_review_package, write_review_package

def main(argv=None):
    p=argparse.ArgumentParser(prog='python -m gremlin_acquisition.cli')
    p.add_argument('--ledger',type=Path,default=Path('.gremlin-acquisition/ledger.sqlite3'))
    p.add_argument('--root',default='Portland'); p.add_argument('--batches',type=int,default=3)
    p.add_argument('--ics',type=Path); p.add_argument('--source-url',default='https://replay.invalid/calendar.ics')
    p.add_argument('--region-config', type=Path, help='Build a frontend-aware POI review package from a region config')
    p.add_argument('--source-body', type=Path, help='Replay JSON body for the configured source')
    p.add_argument('--output-dir', type=Path, default=Path('promotion-artifacts/packages'))
    a=p.parse_args(argv); a.ledger.parent.mkdir(parents=True,exist_ok=True)
    ledger=AcquisitionLedger(a.ledger); plans=AcquisitionPlanner(WklsGeography(),ledger).plan(root=a.root,max_batches=a.batches)
    if a.ics:
        events=[validate_event(e,date.today().isoformat()) for e in parse_ics(a.ics.read_text(encoding='utf-8'),a.source_url)]
        source=SourceRecord(a.source_url,'replay.invalid',plans[0].geography.id,events=events); apply_source_result(source,events); ledger.upsert(source)
    package = None
    if a.region_config:
        if not a.source_body:
            p.error('--source-body is required with --region-config')
        config = json.loads(a.region_config.read_text(encoding='utf-8'))
        need = need_from_region_config(config)
        source_config = (config.get('sources') or [config])[0]
        adapter_result = acquire(source_config, lambda _: a.source_body.read_text(encoding='utf-8'))
        package = build_review_package(need, adapter_result.records, [source_config.get('url', '')])
        write_review_package(package, a.output_dir)
        ledger.record_review_package(package)
        ledger.record_coverage('cli-review', {**package['coverage'], 'packageId': package['packageId'], 'adapterStatus': adapter_result.status})
    print(json.dumps({'plans':[{'geography':x.geography.name,'score':x.score.priority,'reason':x.reason} for x in plans], 'reviewPackageId': package['packageId'] if package else None, 'kpi':summarize(ledger)},indent=2,sort_keys=True))

if __name__ == '__main__': main()
