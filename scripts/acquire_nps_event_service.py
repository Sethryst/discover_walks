"""Acquire Wolf Trap events from the public NPS event calendar service."""
from __future__ import annotations
import json,sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
SOURCE_ID='nps-wolf-trap'; BASE='https://www.nps.gov/common/components/nps/eventcalendar/EventCalendarService.cfc'
def main():
 now=datetime.now(timezone.utc); params={'method':'getEvents','parkCode':'wotr','dateStart':now.date().isoformat(),'dateEnd':(now.date().replace(day=28)).isoformat(),'expandRecurring':'true','pageSize':'50','pageNumber':'1'}
 # Use a one-month window without relying on calendar arithmetic from an inferred date.
 from datetime import timedelta
 params['dateEnd']=(now+timedelta(days=31)).date().isoformat(); endpoint=BASE+'?'+urlencode(params)
 data=json.loads(urlopen(Request(endpoint,headers={'User-Agent':'Gremlin-Lab/1.0','Accept':'application/json'}),timeout=30).read())
 path=ROOT/'motherbird/regions/fairfax-county-va/civic/index.json'; payload=json.loads(path.read_text(encoding='utf-8')); artifact=payload['artifacts']['events']; existing={x['id'] for x in artifact['items']}; added=0
 for event in data.get('data',[]):
  if not event.get('id') or not event.get('dateStart') or not event.get('location'): continue
  times=event.get('times') or [{}]; t=times[0]; start=f"{event['dateStart']}T{datetime.strptime(t.get('timeStart','12:00 PM'),'%I:%M %p').strftime('%H:%M:%S')}Z"
  eid=f"nps:wotr:{event['id']}:{event['dateStart']}"; official=event.get('infoURL') or 'https://www.nps.gov/wotr/planyourvisit/calendar.htm'
  if eid in existing: continue
  artifact['items'].append({'id':eid,'title':event['title'],'date':event['dateStart'],'startsAt':start,'endsAt':None,'locationLabel':event['location'],'venueAddress':event['location'],'summary':event.get('description','').replace('<p>','').replace('</p>',''),'officialUrl':official,'expiresAt':start,'latitude':float(event['latitude']),'longitude':float(event['longitude']),'source':{'name':'National Park Service - Wolf Trap','url':endpoint,'authorityTier':'federal_government','reviewStatus':'verified'}}); added+=1
 artifact['generatedAt']=now.isoformat().replace('+00:00','Z'); path.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8'); print(json.dumps({'source':SOURCE_ID,'discovered':len(data.get('data',[])),'published':added,'endpoint':endpoint}))
if __name__=='__main__': main()
