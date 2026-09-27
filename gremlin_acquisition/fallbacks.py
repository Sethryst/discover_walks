from .models import EventEvidence, SourceRecord, SourceStatus
FALLBACK_CHAIN=("official event API","official ICS/calendar feed","official JSON-LD event page","official RSS feed","official organization events page","official venue, park, library, arts, or downtown calendar","official municipal calendar","redirect, sitemap, or replacement-source discovery","manual investigation")
def attempt(ledger, run_id, geography_id, source_url, method, result, reason=None, evidence_url=None, events=False):
    ledger.record_attempt(run_id, geography_id, source_url, method, result, reason, evidence_url, events); return events
def validate_event(event, now_date):
    warnings=[]
    if not event.official_url: warnings.append("missing official URL")
    if not event.start: warnings.append("missing start")
    event.expired=bool(event.start and event.start[:10] < now_date)
    if event.expired: warnings.append("expired")
    if event.latitude is None or event.longitude is None: warnings.append("missing coordinates")
    event.warnings=warnings; return event
def apply_source_result(source: SourceRecord, events, migrated_to=None):
    if migrated_to: source.status=SourceStatus.SOURCE_MIGRATED; source.replacement_url=migrated_to
    elif not events: source.status=SourceStatus.NO_CURRENT_EVENTS
    elif any(e.warnings and "expired" not in e.warnings for e in events): source.status=SourceStatus.MISSING_GEO
    else: source.status=SourceStatus.READY_FOR_REVIEW
    source.events=events; return source
