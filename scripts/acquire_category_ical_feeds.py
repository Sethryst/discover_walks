"""Acquire municipal category iCal feeds discovered from public calendar pages."""
from __future__ import annotations
import json,sys
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig
FEEDS={
 'events-loudoun-gov-6856d112':('loudoun-county-va','Loudoun County Calendar','https://www.loudoun.gov/common/modules/iCalendar/iCalendar.aspx?catID={cid}&feed=calendar',list(range(14,48)),[-77.64,39.08]),
 'meetings-loudoun-gov-349cf574':('loudoun-county-va','Loudoun County Calendar','https://www.loudoun.gov/common/modules/iCalendar/iCalendar.aspx?catID={cid}&feed=calendar',list(range(14,48)),[-77.64,39.08]),
 'events-norfolk-gov-67d13024':('norfolk','City of Norfolk Calendar','https://www.norfolk.gov/common/modules/iCalendar/iCalendar.aspx?catID={cid}&feed=calendar',[24,152,168,25,169,73,158,75,160,173,153,171,154,149,165,145,166,161,148,146,163,167,151,174,155,162,147,157,156,164],[-76.2859,36.8508]),
 'meetings-norfolk-gov-67d13024':('norfolk','City of Norfolk Calendar','https://www.norfolk.gov/common/modules/iCalendar/iCalendar.aspx?catID={cid}&feed=calendar',[24,152,168,25,169,73,158,75,160,173,153,171,154,149,165,145,166,161,148,146,163,167,151,174,155,162,147,157,156,164],[-76.2859,36.8508]),
 'events-sfrecpark-org-822dab73':('san-francisco','San Francisco Recreation and Parks Calendar','https://sfrecpark.org/common/modules/iCalendar/iCalendar.aspx?catID={cid}&feed=calendar',[43,34,28,39,35,22,37,14,30,41,32,42,40,33,29],[-122.4194,37.7749]),
}
def main():
 now=datetime.now(timezone.utc); totals={}
 for source_id,(region,name,template,cats,coords) in FEEDS.items():
  path=ROOT/'motherbird/regions'/region/'civic/index.json'; payload=json.loads(path.read_text(encoding='utf-8')); key='meetings' if source_id.startswith('meetings-') else 'events'
  if key not in payload['artifacts']: payload['artifacts'][key]={'schemaVersion':1,'regionId':region,'producer':'municipal-ical-static','generatedAt':now.isoformat().replace('+00:00','Z'),'items':[]}
  artifact=payload['artifacts'][key]; existing={x['id'] for x in artifact['items']}; added=0; discovered=0
  for cid in cats:
   url=template.format(cid=cid); source=SourceConfig(id=source_id,name=name,provider='rss_ics_events',url=url,domains=('event',),license_url=url,provider_options={'defaultCoordinates':coords,'limit':500})
   try: features,report=RssIcsEventsProvider().acquire(source,{})
   except Exception: continue
   discovered+=len(features)
   for f in features:
    p=f.properties
    try: start=datetime.fromisoformat(str(p['startsAt']).replace('Z','+00:00'))
    except (KeyError,ValueError): continue
    if start<=now or not p.get('venueAddress'): continue
    eid=f'{source_id}:{f.source_id}:{start.date()}'
    if eid in existing: continue
    artifact['items'].append({'id':eid,'title':p['name'],'date':start.date().isoformat(),'startsAt':p['startsAt'],'endsAt':p.get('endsAt'),'locationLabel':p['venueAddress'],'venueAddress':p['venueAddress'],'summary':p.get('summary') or f'An event listed by {name}.','officialUrl':p.get('officialUrl') or url,'expiresAt':p.get('endsAt') or p['startsAt'],'source':{'name':name,'url':url,'authorityTier':'local_government','reviewStatus':'verified'}}); added+=1
  artifact['generatedAt']=now.isoformat().replace('+00:00','Z'); path.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8'); totals[source_id]={'discovered':discovered,'published':added}
 print(json.dumps(totals,sort_keys=True))
if __name__=='__main__': main()
