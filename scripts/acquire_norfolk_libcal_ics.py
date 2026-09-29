"""Acquire Norfolk Public Library's documented public LibCal iCal feed."""
from __future__ import annotations
import json,sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig
SOURCE_ID='events-norfolk-libcal-com-ed2e4bde'; URL='https://norfolk.libcal.com/ical_subscribe.php?src=p&cid=17863'
def main():
 source=SourceConfig(id=SOURCE_ID,name='Norfolk Public Library Calendar',provider='rss_ics_events',url=URL,domains=('event',),license_url=URL,provider_options={'defaultCoordinates':[-76.2859,36.8508],'limit':500})
 features,report=RssIcsEventsProvider().acquire(source,{})
 now=datetime.now(timezone.utc); path=ROOT/'motherbird/regions/norfolk/civic/index.json'; payload=json.loads(path.read_text(encoding='utf-8'))
 artifact=payload.setdefault('artifacts',{}).setdefault('events',{'schemaVersion':1,'regionId':'norfolk','producer':'libcal-ics-static','generatedAt':now.isoformat().replace('+00:00','Z'),'items':[]}); existing={x['id'] for x in artifact['items']}; added=0
 for f in features:
  p=f.properties
  try: start=datetime.fromisoformat(str(p['startsAt']).replace('Z','+00:00'))
  except (KeyError,ValueError): continue
  address=p.get('venueAddress')
  if start<=now or not address: continue
  eid=f'norfolk:libcal:{f.source_id}'
  if eid in existing: continue
  artifact['items'].append({'id':eid,'title':p['name'],'date':start.date().isoformat(),'startsAt':p['startsAt'],'endsAt':p.get('endsAt'),'locationLabel':address,'venueAddress':address,'summary':p.get('summary') or 'An event listed by Norfolk Public Library.','officialUrl':p.get('officialUrl') or URL,'expiresAt':p.get('endsAt') or p['startsAt'],'source':{'name':source.name,'url':URL,'authorityTier':'public_library','reviewStatus':'verified'}}); added+=1
 artifact['generatedAt']=now.isoformat().replace('+00:00','Z'); path.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8'); print(json.dumps({'source':SOURCE_ID,'report':report,'published':added}))
if __name__=='__main__': main()
