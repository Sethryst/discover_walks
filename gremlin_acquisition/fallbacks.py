from .models import EventEvidence, SourceRecord, SourceStatus
from datetime import datetime, timezone
import hashlib, json, re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree
FALLBACK_CHAIN=("official event API","official ICS/calendar feed","official JSON-LD event page","official RSS feed","official organization events page","official venue, park, library, arts, or downtown calendar","official municipal calendar","redirect, sitemap, or replacement-source discovery","manual investigation")
def attempt(ledger, run_id, geography_id, source_url, method, result, reason=None, evidence_url=None, events=False):
    ledger.record_attempt(run_id, geography_id, source_url, method, result, reason, evidence_url, events); return events

def canonical_url(url):
    """Normalize host/path while retaining meaningful query parameters."""
    parts=urlsplit(url.strip()); host=(parts.hostname or '').lower().removeprefix('www.')
    port='' if parts.port in (None,80,443) else f':{parts.port}'
    query=urlencode(sorted((k,v) for k,v in parse_qsl(parts.query,keep_blank_values=True) if not k.lower().startswith(('utm_','fbclid'))))
    return urlunsplit((parts.scheme.lower(),host+port,parts.path.rstrip('/') or '/',query,''))

def classify_fetch(status_code, error=None, events=None):
    if error:
        return 'temporary failure' if any(x in str(error).lower() for x in ('timeout','429','500','502','503','504')) else 'permanent failure'
    if status_code in (301,302,307,308): return 'redirected'
    if status_code >= 400: return 'temporary failure' if status_code >= 500 or status_code==429 else 'permanent failure'
    return 'succeeded with events' if events else 'succeeded empty'

def follow_redirects(start, redirects, limit=5):
    """Follow cached redirect edges and return (terminal, cycle)."""
    edges={canonical_url(k): canonical_url(v) for k,v in redirects.items()}; seen=[]; current=canonical_url(start)
    for _ in range(limit):
        if current in seen: return current, True
        seen.append(current); nxt=edges.get(current)
        if not nxt: return current, False
        current=canonical_url(nxt)
    return current, bool(edges.get(current))
def validate_event(event, now_date):
    warnings=[]
    if not event.official_url: warnings.append("missing official URL")
    if not event.start: warnings.append("missing start")
    try: event.expired=bool(event.start and datetime.fromisoformat(event.start.replace('Z','+00:00')).date().isoformat() < now_date)
    except ValueError: warnings.append("invalid start timestamp")
    if event.expired: warnings.append("expired")
    if event.latitude is None or event.longitude is None: warnings.append("missing coordinates")
    event.warnings=warnings; return event

def parse_ics(body, source_url, retrieved_at=None):
    rows=[]; current={}
    for line in body.replace('\\n','\n').splitlines():
        if line == 'BEGIN:VEVENT': current={}
        elif line == 'END:VEVENT' and current.get('SUMMARY'):
            start=current.get('DTSTART',''); start=start.split(':',1)[-1]
            if len(start)==8: start=f'{start[:4]}-{start[4:6]}-{start[6:]}T00:00:00+00:00'
            rows.append(EventEvidence(current['SUMMARY'],start,current.get('URL',source_url),source_url,current.get('UID'),end=current.get('DTEND'),organization=current.get('ORGANIZER'),parser='ics',retrieved_at=retrieved_at or datetime.now(timezone.utc).isoformat(),raw_evidence_sha256=hashlib.sha256(body.encode()).hexdigest()))
        elif ':' in line: k,v=line.split(':',1); current[k.split(';',1)[0]]=v
    return rows

def parse_jsonld(body, source_url):
    events=[]
    for raw in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>',body,re.S|re.I):
        try: data=json.loads(raw)
        except json.JSONDecodeError: continue
        items=data if isinstance(data,list) else data.get('@graph',[]) if isinstance(data,dict) else [data]
        for x in items:
            if isinstance(x,dict) and (x.get('@type')=='Event' or 'startDate' in x): events.append(EventEvidence(x.get('name',''),x.get('startDate',''),x.get('url',source_url),source_url,x.get('@id'),end=x.get('endDate'),parser='json-ld'))
    return events

def parse_rss(body, source_url, retrieved_at=None):
    events=[]
    try: root=ElementTree.fromstring(body)
    except ElementTree.ParseError: return events
    for item in root.iter():
        if item.tag.rsplit('}',1)[-1].lower() not in ('item','entry'): continue
        values={child.tag.rsplit('}',1)[-1].lower(): (child.text or '').strip() for child in item}
        title=values.get('title'); start=values.get('startdate') or values.get('pubdate') or values.get('updated')
        if title and start: events.append(EventEvidence(title,start,values.get('link') or source_url,source_url,values.get('guid') or values.get('id'),parser='rss',retrieved_at=retrieved_at or datetime.now(timezone.utc).isoformat()))
    return events
def apply_source_result(source: SourceRecord, events, migrated_to=None):
    if migrated_to: source.status=SourceStatus.SOURCE_MIGRATED; source.replacement_url=migrated_to
    elif not events: source.status=SourceStatus.NO_CURRENT_EVENTS
    elif any(e.warnings and "expired" not in e.warnings for e in events): source.status=SourceStatus.MISSING_GEO
    else: source.status=SourceStatus.READY_FOR_REVIEW
    source.events=events; return source
