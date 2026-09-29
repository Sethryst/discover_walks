"""Capture future records from explicit RSS/Atom/ICS backlog feeds."""
from __future__ import annotations
import json, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig
from app.gremlins.base import RetryableGremlinError

def main():
    catalog = json.loads((ROOT/'motherbird/data/learn/source-adapters.json').read_text())['records']
    now = datetime.now(timezone.utc); provider = RssIcsEventsProvider()
    for r in catalog:
        url = r['url'].lower()
        if not r['id'].startswith('events-') or not any(x in url for x in ('rss','feed','ical','ics','community-calendar')):
            continue
        path = ROOT/'motherbird/regions'/r['regionId']/'civic/index.json'
        if not path.exists(): print(json.dumps({'source':r['id'],'skipped':'no civic package'})); continue
        try:
            cfg=SourceConfig(id=r['id'],name=r['publisher'],provider='rss_ics_events',url=r['url'],domains=('event',),license_url=r['url'],provider_options={'defaultCoordinates':[-77,39],'limit':250})
            features, report=provider.acquire(cfg,{})
        except Exception as exc:
            print(json.dumps({'source':r['id'],'skipped':type(exc).__name__})); continue
        data=json.loads(path.read_text()); artifacts=data.get('artifacts',{})
        if 'events' not in artifacts: print(json.dumps({'source':r['id'],'skipped':'no events contract'})); continue
        items=artifacts['events']['items']; existing={x['id'] for x in items}; added=0
        for f in features:
            starts=f.properties.get('startsAt')
            try: start=datetime.fromisoformat(starts.replace('Z','+00:00'))
            except (AttributeError,ValueError): continue
            if start <= now: continue
            eid=f'backlog:{r["id"]}:{f.source_id}'
            if eid in existing: continue
            items.append({'id':eid,'title':f.properties['name'],'date':start.date().isoformat(),'startsAt':starts,'endsAt':f.properties.get('endsAt'),'locationLabel':r['regionName'],'summary':f.properties.get('summary') or f'An event listed by {r["publisher"]}.','officialUrl':f.properties.get('officialUrl') or r['url'],'expiresAt':f'{start.date().isoformat()}T23:59:59Z','source':{'name':r['publisher'],'url':r['url'],'reviewStatus':'adapter-captured'}}); added+=1
        if added: path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
        print(json.dumps({'source':r['id'],'report':report,'added':added}))
if __name__=='__main__': main()
