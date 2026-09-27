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

def main(argv=None):
    p=argparse.ArgumentParser(prog='python -m gremlin_acquisition.cli')
    p.add_argument('--ledger',type=Path,default=Path('.gremlin-acquisition/ledger.sqlite3'))
    p.add_argument('--root',default='Portland'); p.add_argument('--batches',type=int,default=3)
    p.add_argument('--ics',type=Path); p.add_argument('--source-url',default='https://replay.invalid/calendar.ics')
    a=p.parse_args(argv); a.ledger.parent.mkdir(parents=True,exist_ok=True)
    ledger=AcquisitionLedger(a.ledger); plans=AcquisitionPlanner(WklsGeography(),ledger).plan(root=a.root,max_batches=a.batches)
    if a.ics:
        events=[validate_event(e,date.today().isoformat()) for e in parse_ics(a.ics.read_text(encoding='utf-8'),a.source_url)]
        source=SourceRecord(a.source_url,'replay.invalid',plans[0].geography.id,events=events); apply_source_result(source,events); ledger.upsert(source)
    print(json.dumps({'plans':[{'geography':x.geography.name,'score':x.score.priority,'reason':x.reason} for x in plans],'kpi':summarize(ledger)},indent=2,sort_keys=True))

if __name__ == '__main__': main()
