"""Acquire NYC Parks' public Event microdata aggregate endpoint."""
from __future__ import annotations
import hashlib,json,sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,urlopen
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
SOURCE_ID='events-nycgovparks-org-3468fa93'; BASE='https://www.nycgovparks.org'; URL=BASE+'/events/nature/ajax/aggregate'
def main():
 html=urlopen(Request(URL,headers={'User-Agent':'Gremlin-Lab/1.0'}),timeout=30).read().decode('utf8','replace'); soup=BeautifulSoup(html,'html.parser'); now=datetime.now(timezone.utc); path=ROOT/'motherbird/regions/new-york-city/civic/index.json'; payload=json.loads(path.read_text(encoding='utf-8')); artifact=payload['artifacts']['events']; existing={x['id'] for x in artifact['items']}; added=0; rejected=0
 for node in soup.select('[itemscope][itemtype="http://schema.org/Event"]'):
  start=node.select_one('[itemprop="startDate"]'); title=node.select_one('[itemprop="name"]'); link=node.select_one('a[href]'); address=node.select_one('[itemprop="address"]'); location=node.select_one('[itemprop="location"]')
  if not start or not title or not link or not location: rejected+=1; continue
  try: dt=datetime.fromisoformat(start.get('content','').replace('Z','+00:00'))
  except ValueError: rejected+=1; continue
  if dt<=now: continue
  official=BASE+link['href'] if link['href'].startswith('/') else link['href']; venue=' '.join(location.get_text(' ',strip=True).split());
  if address: venue=' '.join(address.get_text(' ',strip=True).split()) or venue
  eid='nycparks:aggregate:'+hashlib.sha256((official+'|'+start.get('content','')).encode()).hexdigest()[:20]
  if eid in existing: continue
  end=node.select_one('[itemprop="endDate"]'); desc=node.select_one('[itemprop="description"]')
  artifact['items'].append({'id':eid,'title':title.get_text(' ',strip=True),'date':dt.date().isoformat(),'startsAt':start.get('content'),'endsAt':end.get('content') if end else None,'locationLabel':venue,'venueAddress':venue,'summary':desc.get_text(' ',strip=True) if desc else 'An event listed by NYC Parks.','officialUrl':official,'expiresAt':end.get('content') if end else start.get('content'),'source':{'name':'NYC Parks','url':URL,'authorityTier':'city_government','reviewStatus':'verified'}}); added+=1
 artifact['generatedAt']=now.isoformat().replace('+00:00','Z'); path.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n',encoding='utf-8'); print(json.dumps({'source':SOURCE_ID,'discovered':len(soup.select('[itemscope][itemtype="http://schema.org/Event"]')),'published':added,'rejected':rejected}))
if __name__=='__main__': main()
