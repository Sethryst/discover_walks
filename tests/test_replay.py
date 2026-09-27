from gremlin_acquisition.replay import run_offline_pilot, run_portland_poi_pilot

def test_offline_pilot_reaches_release_and_rollback(tmp_path):
    result=run_offline_pilot('fixtures/acquisition',tmp_path/'ledger.sqlite3',tmp_path/'packages',tmp_path/'audit.jsonl')
    assert result['sourceStatus']=='APPROVED' and result['selectedEvents']==1
    assert (tmp_path/'packages'/f"{result['packageId']}.json").exists()
    assert 'rollback' in result and (tmp_path/'audit.jsonl').exists()

def test_portland_poi_pilot_covers_declared_frontend_categories(tmp_path):
    result=run_portland_poi_pilot('fixtures/acquisition',tmp_path/'ledger.sqlite3',tmp_path/'packages')
    assert result['recordCount'] == 4
    assert result['coverage']['gaps'] == []
    assert result['coverage']['geographyId'] == 'replay-portland'
    assert (tmp_path/'packages'/f"{result['packageId']}.json").exists()
