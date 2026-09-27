from gremlin_acquisition.replay import run_offline_pilot

def test_offline_pilot_reaches_release_and_rollback(tmp_path):
    result=run_offline_pilot('fixtures/acquisition',tmp_path/'ledger.sqlite3',tmp_path/'packages',tmp_path/'audit.jsonl')
    assert result['sourceStatus']=='APPROVED' and result['selectedEvents']==1
    assert (tmp_path/'packages'/f"{result['packageId']}.json").exists()
    assert 'rollback' in result and (tmp_path/'audit.jsonl').exists()
