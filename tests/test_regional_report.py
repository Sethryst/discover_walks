from gremlin_acquisition.regional_report import build_regional_readiness_report, build_search_cycle_report


def test_regional_report_compares_package_coverage_and_readiness():
    packages = [
        {'geography': {'id': 'denver', 'query': 'Denver'},
         'records': [{'quality': {'total': 0.9}}], 'rejected': [], 'duplicates': {},
         'coverage': {'gaps': []}, 'sourceMetadata': [{'licenseUrl': 'https://denver.gov/license', 'authorityTier': 'city_government'}],
         'coverageMetrics': {'discoveredRecords': 2, 'acceptedRecords': 1, 'rejectedRecords': 0, 'duplicateRecords': 1}},
        {'geography': {'id': 'portland', 'query': 'Portland'},
         'records': [{'quality': {'total': 0.9}}], 'rejected': [], 'duplicates': {},
         'coverage': {'gaps': ['library']}, 'sourceMetadata': [{'licenseUrl': 'https://portland.gov/license', 'authorityTier': 'city_government'}],
         'coverageMetrics': {'discoveredRecords': 1, 'acceptedRecords': 1, 'rejectedRecords': 0, 'duplicateRecords': 0}},
    ]
    report = build_regional_readiness_report(packages)
    assert report['regionCount'] == 2
    assert report['readyRegionCount'] == 1
    assert report['regions'][0]['regionId'] == 'denver'
    assert report['regions'][1]['coverageGaps'] == ['library']


def test_search_cycle_report_attaches_search_outcomes_to_regions():
    package = {'geography': {'id': 'portland', 'query': 'Portland'}, 'records': [],
               'rejected': [], 'duplicates': {}, 'coverage': {'gaps': ['park']}}
    report = build_search_cycle_report(
        run_id='cycle-1',
        search_feedback=[{'geography_id': 'portland', 'outcome': 'SUCCEEDED'},
                         {'geography_id': 'portland', 'outcome': 'EMPTY'}],
        packages=[package],
    )
    assert report['searchQueryCount'] == 2
    assert report['readiness']['regions'][0]['search']['successful'] == 1
    assert report['readiness']['regions'][0]['search']['empty'] == 1
