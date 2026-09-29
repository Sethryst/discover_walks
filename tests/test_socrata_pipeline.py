import json

from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.package_intelligence import FeatureRequirement, RegionalNeed
from gremlin_acquisition.pipeline import acquire_review_package


def test_multi_page_socrata_reaches_review_with_page_health(tmp_path):
    config = {
        'provider': 'socrata', 'url': 'https://data.example/parks.json',
        'category': 'park', 'pageSize': 2, 'licenseUrl': 'https://city.gov/license',
        'authorityTier': 'city_government',
    }
    pages = {
        '%24offset=0': [
            {'id': 'p1', 'name': 'Park One', 'latitude': 45.50, 'longitude': -122.60},
            {'id': 'p2', 'name': 'Park Two', 'latitude': 45.51, 'longitude': -122.61},
        ],
        '%24offset=2': [
            {'id': 'p3', 'name': 'Park Three', 'latitude': 45.52, 'longitude': -122.62},
        ],
    }

    def transport(url):
        for marker, rows in pages.items():
            if marker in url:
                return json.dumps(rows)
        raise AssertionError(f'unexpected page URL: {url}')

    result = acquire_review_package(
        'socrata-replay',
        RegionalNeed('Portland', 'portland', (FeatureRequirement('park'),)),
        [config], transport, AcquisitionLedger(tmp_path / 'ledger.sqlite3'), tmp_path / 'packages',
    )
    package = result['package']
    assert result['fallbackStatus'] == 'SUCCEEDED'
    assert package['coverageMetrics']['discoveredRecords'] == 3
    assert package['coverageMetrics']['acceptedRecords'] == 3
    assert package['sourceHealth'][0]['metadata']['pagesAttempted'] == 2
    assert package['sourceHealth'][0]['metadata']['stoppedOnShortPage'] is True
    assert package['sourceMetadata'][0]['licenseUrl'] == 'https://city.gov/license'
