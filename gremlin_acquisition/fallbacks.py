from .models import EventEvidence, SourceRecord, SourceStatus
from datetime import datetime, timezone
import hashlib, json, re
FALLBACK_CHAIN=("official event API","official ICS/calendar feed","official JSON-LD event page","official RSS feed","official organization events page","official venue, park, library, arts, or downtown calendar","official municipal calendar","redirect, sitemap, or replacement-source discovery","manual investigation")
def attempt(ledger, run_id, geography_id, source_url, method, result, reason=None, evidence_url=None, events=False):
    ledger.record_attempt(run_id, geography_id, source_url, method, result, reason, evidence_url, events); return events
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
def apply_source_result(source: SourceRecord, events, migrated_to=None):
    if migrated_to: source.status=SourceStatus.SOURCE_MIGRATED; source.replacement_url=migrated_to
    elif not events: source.status=SourceStatus.NO_CURRENT_EVENTS
    elif any(e.warnings and "expired" not in e.warnings for e in events): source.status=SourceStatus.MISSING_GEO
    else: source.status=SourceStatus.READY_FOR_REVIEW
    source.events=events; return source
