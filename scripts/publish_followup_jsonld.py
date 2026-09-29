"""Promote follow-up JSON-LD records that retain an explicit venue address."""
from __future__ import annotations
import hashlib,json
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 report=json.loads((ROOT/'expansion-queues/followup-jsonld-discovery.json').read_text())
 grouped={}
 for row in report['results']:
  for event in row.get('accepted',[]):
   if event.get('venueAddress') or event.get('coordinates'): grouped.setdefault((row['regionId'],row['sourceId']),[]).append(event)
 added=0; sources=[]
 for (region,source_id),events in grouped.items():
  path=ROOT/'motherbird/regions'/region/'civic/index.json'
  if not path.exists(): continue
  payload=json.loads(path.read_text(encoding='utf-8')); now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
  artifact=payload.setdefault('artifacts',{}).setdefault('events',{'schemaVersion':1,'regionId':region,'producer':'followup-jsonld-static','generatedAt':now,'items':[]})
  existing={x['id'] for x in artifact['items']}; local=0
  for event in events:
   eid='followup:'+source_id+':'+hashlib.sha256((event['officialUrl']+'|'+event['title']+'|'+event['startsAt']).encode()).hexdigest()[:16]
   if eid in existing: continue
   item={'id':eid,'title':event['title'],'date':event['startsAt'][:10],'startsAt':event['startsAt'],'endsAt':event.get('endsAt'),'locationLabel':event.get('venueAddress') or region,'venueAddress':event.get('venueAddress'),'summary':event.get('summary') or f"An event listed by {source_id}.",'officialUrl':event['officialUrl'],'expiresAt':event.get('endsAt') or event['startsAt'],'source':{'name':source_id,'url':event['sourceEndpoint'],'reviewStatus':'verified'}}
   if event.get('coordinates'): item.update({'longitude':event['coordinates'][0],'latitude':event['coordinates'][1]})
   artifact['items'].append(item); local+=1
  if local: artifact['generatedAt']=now; path.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8'); added+=local; sources.append(source_id)
 print(json.dumps({'sources':sorted(set(sources)),'recordsAdded':added}))
if __name__=='__main__': main()
