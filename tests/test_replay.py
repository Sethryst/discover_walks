from gremlin_acquisition.replay import run_offline_pilot, run_portland_poi_pilot, run_discovered_region_pilot

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


def test_new_region_discovery_replay_plans_and_packages_without_portland(tmp_path):
    result = run_discovered_region_pilot('fixtures/acquisition', tmp_path/'ledger.sqlite3', tmp_path/'packages')
    assert result['discoveryStatus'] == 'NEW'
    assert result['geographyId'] == 'replay-new-city'
    assert result['plannedGeographies'] == ['replay-new-city']
    assert result['coverage']['gaps'] == []
    assert result['ledgerDiscoveries'] == 1
    assert result['attemptCount'] == 2
    assert 'prior failure or empty attempt' in result['fallbackReason']
    assert result['sourceProposals'][0]['status'] == 'PROPOSED'
    assert result['sourceProposals'][0]['publication'] == 'not authorized'
    assert result['ledgerSourceProposals'] == 1
    assert (tmp_path/'packages'/f"{result['packageId']}.json").exists()
