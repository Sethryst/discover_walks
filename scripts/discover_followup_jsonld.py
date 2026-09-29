"""Probe discovered official detail endpoints for explicit JSON-LD Events."""
from __future__ import annotations
import json, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT))
from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.source_config import SourceConfig

def probe(row, endpoint):
    try:
        # A neutral fallback is used only to let the existing parser expose
        # explicit venue text; it is never written as event coordinates.
        source=SourceConfig(id=row['id'],name=row.get('publisher',''),provider='jsonld_events',url=endpoint,domains=('event',),license_url=endpoint,provider_options={'defaultCoordinates':[0,0]})
        features,report=JsonLdEventsProvider().acquire(source,{})
        accepted=[]
        for f in features:
            p=f.properties; coords=f.geometry.get('coordinates')
            try: dt=datetime.fromisoformat(str(p.get('startsAt','')).replace('Z','+00:00'))
            except ValueError: continue
            if dt>datetime.now(timezone.utc) and (p.get('venueAddress') or (coords and len(coords)>=2)): accepted.append({'title':p.get('name'),'startsAt':p.get('startsAt'),'endsAt':p.get('endsAt'),'officialUrl':p.get('officialUrl') or endpoint,'summary':p.get('summary'),'venueAddress':p.get('venueAddress'),'coordinates':coords if coords != [0,0] else None,'sourceEndpoint':endpoint})
        return {'sourceId':row['id'],'regionId':row['regionId'],'endpoint':endpoint,'status':'SUCCEEDED','accepted':accepted,'recordCount':report.get('recordCount',0)}
    except Exception as exc: return {'sourceId':row['id'],'regionId':row['regionId'],'endpoint':endpoint,'status':'FAILED','accepted':[],'error':f'{type(exc).__name__}: {exc}'}

def main():
    backlog=json.loads((ROOT/'expansion-queues/regional-source-backlog.json').read_text())
    byid={x['id']:dict(x,regionId=reg['id']) for reg in backlog['regions'] for x in reg['queue'] if x.get('trackingState')!='INTEGRATED_STATIC'}
    targets=[]
    for f in (ROOT/'expansion-queues').glob('source-discovery-batch-*.json'):
        for item in json.loads(f.read_text())['records']:
            row=byid.get(item['source_id'])
            for endpoint in item.get('candidate_endpoints',[])[:10]:
                if row and endpoint.startswith('https://'): targets.append((row,endpoint))
    with ThreadPoolExecutor(max_workers=12) as pool: results=[f.result() for f in as_completed([pool.submit(probe,*t) for t in targets])]
    results.sort(key=lambda x:(x['sourceId'],x['endpoint']))
    out=ROOT/'expansion-queues/followup-jsonld-discovery.json'; out.write_text(json.dumps({'kind':'followup-jsonld-discovery','targetCount':len(targets),'results':results},indent=2)+'\n')
    print(json.dumps({'targets':len(targets),'succeeded':sum(x['status']=='SUCCEEDED' for x in results),'withRecords':sum(bool(x['accepted']) for x in results),'records':sum(len(x['accepted']) for x in results)}))
if __name__=='__main__': main()
