"""Paginate the official DC.gov events listing into civic cards."""
from __future__ import annotations
import html, re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

SOURCE_URL="https://beta.dc.gov/events"
def fetch_cards(now: datetime|None=None, max_pages:int=8)->list[dict]:
    now=now or datetime.now(timezone.utc)
    with ThreadPoolExecutor(max_workers=4) as pool: pages=list(pool.map(_page, range(max_pages)))
    cards=[]
    for p,raw in enumerate(pages): cards.extend(cards_from_html(raw,now,p))
    return sorted({x['id']:x for x in cards}.values(),key=lambda x:(x['date'],x['title']))
def _page(p:int)->str:
    url=SOURCE_URL if p==0 else f'{SOURCE_URL}?page={p}'
    with urlopen(Request(url,headers={'User-Agent':'Gremlin-Lab/1.0'}),timeout=45) as r:return r.read().decode('utf-8','replace')
def cards_from_html(raw:str,now:datetime,page:int=0)->list[dict]:
    out=[]
    for block in re.findall(r'<article[^>]*c-slab-action.*?</article>',raw,re.S|re.I):
        m=re.search(r'<h3[^>]*>.*?<a href="([^"]+)"[^>]*>.*?<span>(.*?)</span>',block,re.S|re.I)
        ts=re.findall(r'<time datetime="([^"]+)',block,re.I)
        loc=re.search(r'</div></div></div><p>(.*?)</p>',block,re.S|re.I)
        if not m or not ts: continue
        try: start=datetime.fromisoformat(ts[0])
        except ValueError: continue
        if start.date()<now.date() or start.date()>now.date()+timedelta(days=90):continue
        title=_plain(m.group(2)); url='https://beta.dc.gov'+m.group(1)
        address=_plain(loc.group(1)) if loc else 'Washington, DC — see official event page'
        end=datetime.fromisoformat(ts[1]) if len(ts)>1 and 'T' in ts[1] else start
        out.append({'id':f'dc:{m.group(1)}:{start.date()}','title':title,'date':start.date().isoformat(),'startsAt':start.isoformat(),'endsAt':end.isoformat(),'locationLabel':address,'venueAddress':address if address!='Washington, DC — see official event page' else None,'summary':'An event published by DC.gov. Check the official page for current participation details.','officialUrl':url,'expiresAt':end.astimezone(timezone.utc).isoformat().replace('+00:00','Z'),'source':{'name':'DC.gov','url':url,'authorityTier':'local_government','reviewStatus':'verified'}})
    return out
def _plain(s:str)->str:return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s))).strip()
