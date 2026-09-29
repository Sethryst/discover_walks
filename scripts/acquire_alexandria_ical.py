"""Acquire Alexandria's public calendar iCal feed into the meetings contract."""
from __future__ import annotations
import json,sys
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig
URL='https://apps.alexandriava.gov/Calendar/iCal.aspx?id=1&ss=09292026'; SOURCE_ID='meetings-apps-alexandriava-gov-c408c804'
def main():
 source=SourceConfig(id=SOURCE_ID,name='City of Alexandria Calendar',provider='rss_ics_events',url=URL,domains=('meeting',),license_url=URL,provider_options={'defaultCoordinates':[-77.0469,38.8048],'limit':500})
 features,report=RssIcsEventsProvider().acquire(source,{})
 now=datetime.now(timezone.utc); path=ROOT/'motherbird/regions/alexandria-va/civic/index.json'; payload=json.loads(path.read_text(encoding='utf-8')); artifact=payload['artifacts']['meetings']; existing={x['id'] for x in artifact['items']}; added=0
 for f in features:
  p=f.properties
  try: start=datetime.fromisoformat(str(p['startsAt']).replace('Z','+00:00'))
  except (KeyError,ValueError): continue
  if start<=now or not p.get('venueAddress'): continue
  eid=f'alexandria-va:ical:{f.source_id}:{start.date()}'
  if eid in existing: continue
  official=p.get('summary',''); marker='https://apps.alexandriava.gov/Calendar/Detail.aspx?si='
  detail=official[official.find(marker):].split()[0] if marker in official else URL
  artifact['items'].append({'id':eid,'title':p['name'],'date':start.date().isoformat(),'startsAt':p['startsAt'],'endsAt':p.get('endsAt'),'locationLabel':p['venueAddress'],'venueAddress':p['venueAddress'],'summary':p.get('summary') or 'A meeting listed by the City of Alexandria.','officialUrl':detail,'expiresAt':p.get('endsAt') or p['startsAt'],'source':{'name':source.name,'url':URL,'authorityTier':'city_government','reviewStatus':'verified'}}); added+=1
 artifact['generatedAt']=now.isoformat().replace('+00:00','Z'); path.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8'); print(json.dumps({'source':SOURCE_ID,'report':report,'published':added}))
if __name__=='__main__': main()
