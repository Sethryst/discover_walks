from gremlin_acquisition.geo import WklsGeography
from gremlin_acquisition.planner import AcquisitionPlanner
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.models import EventEvidence, SourceRecord, SourceStatus
from gremlin_acquisition.fallbacks import validate_event, apply_source_result
from gremlin_acquisition.promotion import PromotionBuilder

def test_portland_expands_and_loop_is_penalized():
    p=AcquisitionPlanner(); plans=p.plan(); assert plans[0].geography.name != "Portland"; assert any(x.geography.name=="Beaverton" for x in plans)
    assert p.score(p.geo.resolve("Portland"),duplicate_count=3).loop_penalty > 0
def test_empty_and_migrated_states():
    s=SourceRecord("https://old.example/events","old.example","g"); apply_source_result(s,[],"https://new.example/events"); assert s.status==SourceStatus.SOURCE_MIGRATED
    s2=SourceRecord("https://x.example/events","x.example","g"); apply_source_result(s2,[]); assert s2.status==SourceStatus.NO_CURRENT_EVENTS
def test_event_validation_and_idempotent_promotion():
    e=validate_event(EventEvidence("Town Fair","2099-05-01T10:00:00Z","https://x/e","https://x",stable_id="e1",latitude=1,longitude=2),"2026-01-01")
    s=SourceRecord("https://x","x","g",status=SourceStatus.APPROVED,events=[e]); b=PromotionBuilder(); a=b.build([s],{"e1"}); c=b.build([s],{"e1"}); assert a==c and a["event_count"]==1
