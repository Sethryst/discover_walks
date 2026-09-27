import pytest
from gremlin_acquisition.release import build_selected_package, rollback_exact

def test_release_requires_explicit_ready_selection(tmp_path):
    report={'generatedAt':'t','rows':[{'sourceId':'s','status':'ready-for-promotion','events':[{'title':'Walk','startsAt':'2099-01-01T10:00:00Z'}]}]}
    payload,path=build_selected_package(report,[report['rows'][0]['events'][0]['title'] and __import__('hashlib').sha256(b's|Walk|2099-01-01T10:00:00Z').hexdigest()[:20]],tmp_path)
    assert payload['packageId'] and path.exists()
    with pytest.raises(ValueError): build_selected_package(report,['not-selected'],tmp_path)

def test_rollback_requires_exact_active_package(tmp_path):
    with pytest.raises(ValueError): rollback_exact('a','b',tmp_path/'audit.jsonl')
    assert rollback_exact('a','a',tmp_path/'audit.jsonl')['preserveLaterPromotions']
