"""Follow official event detail links from discovery results for venue data."""
from __future__ import annotations
import json,sys
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.source_config import SourceConfig
def probe(row):
 try:
  source=SourceConfig(id=row['sourceId'],name=row['sourceId'],provider='jsonld_events',url=row['officialUrl'],domains=('event',),license_url=row['officialUrl'],provider_options={'defaultCoordinates':[0,0]})
  features,report=JsonLdEventsProvider().acquire(source,{})
  accepted=[]
  for f in features:
   p=f.properties
   try: dt=datetime.fromisoformat(str(p.get('startsAt','')).replace('Z','+00:00'))
   except ValueError: continue
   if dt>datetime.now(timezone.utc) and p.get('venueAddress'): accepted.append({'title':p['name'],'startsAt':p['startsAt'],'endsAt':p.get('endsAt'),'officialUrl':p.get('officialUrl') or row['officialUrl'],'summary':p.get('summary'),'venueAddress':p['venueAddress'],'sourceEndpoint':row['officialUrl']})
  return {'sourceId':row['sourceId'],'regionId':row['regionId'],'accepted':accepted,'officialUrl':row['officialUrl'],'recordCount':report.get('recordCount',0)}
 except Exception as exc: return {'sourceId':row['sourceId'],'regionId':row['regionId'],'accepted':[],'officialUrl':row['officialUrl'],'error':f'{type(exc).__name__}: {exc}'}
def main():
 backlog=json.loads((ROOT/'expansion-queues/regional-source-backlog.json').read_text()); unresolved={x['id'] for reg in backlog['regions'] for x in reg['queue'] if x.get('trackingState')!='INTEGRATED_STATIC'}; rows=[]; seen=set()
 for x in json.loads((ROOT/'expansion-queues/followup-jsonld-discovery.json').read_text())['results']:
  if x['sourceId'] not in unresolved: continue
  for e in x.get('accepted',[]):
   key=(x['sourceId'],e.get('officialUrl'))
   if key not in seen and e.get('officialUrl'): seen.add(key); rows.append({'sourceId':x['sourceId'],'regionId':x['regionId'],'officialUrl':e['officialUrl']})
 with ThreadPoolExecutor(max_workers=12) as pool: results=[f.result() for f in as_completed([pool.submit(probe,r) for r in rows])]
 results.sort(key=lambda x:(x['sourceId'],x['officialUrl'])); (ROOT/'expansion-queues/event-detail-jsonld-discovery.json').write_text(json.dumps({'kind':'event-detail-jsonld-discovery','targetCount':len(rows),'results':results},indent=2)+'\n'); print(json.dumps({'targets':len(rows),'withRecords':sum(bool(x['accepted']) for x in results),'records':sum(len(x['accepted']) for x in results)}))
if __name__=='__main__': main()
