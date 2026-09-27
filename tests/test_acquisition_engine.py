from gremlin_acquisition.geo import WklsGeography
from gremlin_acquisition.planner import AcquisitionPlanner
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.models import EventEvidence, SourceRecord, SourceStatus
from gremlin_acquisition.fallbacks import validate_event, apply_source_result, parse_ics, parse_jsonld, parse_rss, canonical_url, follow_redirects
from gremlin_acquisition.promotion import PromotionBuilder

def test_portland_expands_and_loop_is_penalized():
    from gremlin_acquisition.models import Geography
    class Geo:
        def resolve(self, query): return Geography("portland", "Portland", "city")
        def neighbors(self, geography): return []
    p=AcquisitionPlanner(Geo()); plans=p.plan(); assert plans and plans[0].geography.name == "Portland"
    assert p.score(p.geo.resolve("Portland"),duplicate_count=3).loop_penalty > 0
def test_empty_and_migrated_states():
    s=SourceRecord("https://old.example/events","old.example","g"); apply_source_result(s,[],"https://new.example/events"); assert s.status==SourceStatus.SOURCE_MIGRATED
    s2=SourceRecord("https://x.example/events","x.example","g"); apply_source_result(s2,[]); assert s2.status==SourceStatus.NO_CURRENT_EVENTS
def test_event_validation_and_idempotent_promotion():
    e=validate_event(EventEvidence("Town Fair","2099-05-01T10:00:00Z","https://x/e","https://x",stable_id="e1",latitude=1,longitude=2),"2026-01-01")
    s=SourceRecord("https://x","x","g",status=SourceStatus.APPROVED,events=[e]); b=PromotionBuilder(); a=b.build([s],{"e1"}); c=b.build([s],{"e1"}); assert a==c and a["event_count"]==1 and e.quality_score == 1.0

def test_event_quality_score_explains_missing_geometry():
    e=validate_event(EventEvidence("Town Fair","2099-05-01T10:00:00Z","https://x/e","https://x",stable_id="e1"),"2026-01-01")
    assert e.quality_score == 0.8 and "missing coordinates" in e.quality_rationale

def test_replay_parsers_preserve_provenance_and_reject_unresolved_geo():
    ics="BEGIN:VEVENT\\nUID:i1\\nSUMMARY:Town Walk\\nDTSTART:20990101T100000Z\\nURL:https://official.example/walk\\nEND:VEVENT"
    events=parse_ics(ics,"https://official.example/calendar.ics")
    assert events[0].stable_id == "i1" and events[0].source_url.endswith("calendar.ics")
    html='<script type="application/ld+json">{"@type":"Event","name":"Library Walk","startDate":"2099-01-02T10:00:00Z"}</script>'
    assert parse_jsonld(html,"https://official.example/page")[0].parser == "json-ld"
    assert WklsGeography().resolve("Not A Canonical Place").id == ""

def test_invalid_selected_event_is_not_silently_dropped():
    e=EventEvidence("Missing geo","2099-01-01T10:00:00Z","https://x/e","https://x",stable_id="bad")
    validate_event(e,"2026-01-01")
    s=SourceRecord("https://x","x","g",status=SourceStatus.APPROVED,events=[e])
    import pytest
    with pytest.raises(ValueError): PromotionBuilder().build([s],{"bad"})

def test_sqlite_ledger_reloads_and_enforces_global_budget(tmp_path):
    path=tmp_path/'ledger.sqlite3'; first=AcquisitionLedger(path)
    first.record_attempt('r','g','https://x','ics','failed')
    first.upsert(SourceRecord('https://x','x','g'))
    reopened=AcquisitionLedger(path)
    assert len(reopened.attempts)==1 and 'https://x' in reopened.sources
    assert not reopened.budget_available(1)

def test_run_manifest_is_content_bound_and_durable(tmp_path):
    ledger=AcquisitionLedger(tmp_path/'manifest.db')
    first=ledger.manifest('run-1', {'region':'portland'}, {'budget':3}, 'wkls-rev')
    assert first['input_sha256']
    assert ledger.manifest('run-1', {'region':'portland'}, {'budget':3}, 'wkls-rev') == first
    import pytest
    with pytest.raises(ValueError): ledger.manifest('run-1', {'region':'elsewhere'}, {'budget':3}, 'wkls-rev')
    reopened=AcquisitionLedger(tmp_path/'manifest.db'); assert reopened.manifests == [first]

def test_redirect_history_is_durable(tmp_path):
    ledger=AcquisitionLedger(tmp_path/'redirects.db')
    ledger.record_redirect('run-1','https://old.example/events','https://new.example/events',reason='official migration')
    reopened=AcquisitionLedger(tmp_path/'redirects.db')
    assert reopened.redirects[0]['replacement_url'] == 'https://new.example/events'

def test_lifecycle_transitions_are_explicit_and_persisted(tmp_path):
    ledger=AcquisitionLedger(tmp_path/'l.db'); source=SourceRecord('https://x','x','g')
    ledger.transition(source,'VALIDATING','fetch started'); ledger.transition(source,'READY FOR REVIEW','dated event found')
    import pytest
    with pytest.raises(ValueError): ledger.transition(source,'PROMOTED','skip approval')
    reopened=AcquisitionLedger(tmp_path/'l.db'); assert len(reopened.transitions)==2

def test_event_lifecycle_history_persists_new_updated_expired_and_removed(tmp_path):
    ledger=AcquisitionLedger(tmp_path/'events.db')
    first=validate_event(EventEvidence('Walk','2099-01-01T10:00:00Z','https://x/w','https://x',stable_id='e1',latitude=1,longitude=2),'2026-01-01')
    ledger.record_event_transitions('r1','https://x',[ ],[first])
    expired=validate_event(EventEvidence('Walk moved','2020-01-01T10:00:00Z','https://x/w','https://x',stable_id='e1',latitude=1,longitude=2),'2026-01-01')
    ledger.record_event_transitions('r2','https://x',[first],[expired])
    ledger.record_event_transitions('r3','https://x',[expired],[])
    reopened=AcquisitionLedger(tmp_path/'events.db')
    assert [row['state'] for row in reopened.event_transitions] == ['NEW','EXPIRED','REMOVED']
    assert reopened.event_transitions[0]['qualityScore'] == 1.0

def test_rss_canonicalization_and_redirect_cycles():
    rss='<rss><channel><item><title>River Walk</title><pubDate>2099-01-01T10:00:00Z</pubDate><guid>r1</guid></item></channel></rss>'
    assert parse_rss(rss,'https://example.gov/feed')[0].stable_id == 'r1'
    assert canonical_url('HTTPS://WWW.Example.gov/events/?utm_source=x&x=1') == 'https://example.gov/events?x=1'
    terminal, cycle=follow_redirects('https://a.test', {'https://a.test':'https://b.test','https://b.test':'https://a.test'})
    assert terminal == 'https://a.test' and cycle

def test_verified_neighbor_prefilter_never_fabricates_ids():
    from gremlin_acquisition.models import Geography
    target=Geography('a','A','city',bbox=(0,0,1,1)); touching=Geography('b','B','city',bbox=(1,0,2,1)); far=Geography('c','C','city',bbox=(4,4,5,5))
    assert [x.id for x in WklsGeography().verified_neighbors(target,[touching,far])] == ['b']
    assert WklsGeography().verified_neighbors(Geography('','Unknown','unresolved'),[touching]) == []

def test_kpi_reports_honest_empty_values_and_lifecycle_counts():
    from gremlin_acquisition.kpi import summarize
    ledger=AcquisitionLedger(); source=SourceRecord('https://x','x','g',status=SourceStatus.NO_CURRENT_EVENTS)
    ledger.upsert(source); ledger.record_attempt('r','g','https://x','rss','succeeded empty',produced_events=False)
    kpi=summarize(ledger); assert kpi['empty_calendars']==1 and kpi['current_event_yield']==0 and kpi['geocoded_event_coverage'] is None

def test_wkls_scoped_portland_resolution_when_runtime_dependencies_exist():
    place=WklsGeography().resolve('Portland, Oregon')
    if place.id: assert place.name == 'Portland' and place.source_revision
