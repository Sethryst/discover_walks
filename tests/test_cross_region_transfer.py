import json

from gremlin_acquisition.adapters import acquire, discover_arcgis_layers
from gremlin_acquisition.ledger import AcquisitionLedger
from gremlin_acquisition.package_intelligence import FeatureRequirement, RegionalNeed
from gremlin_acquisition.pipeline import acquire_review_package
from gremlin_acquisition.rollout_gate import evaluate_review_package_gate


def test_denver_html_events_reach_review_package(tmp_path):
    config = {
        'provider': 'html_directory', 'url': 'https://engagedenver.denvergov.org/Calendar',
        'category': 'event', 'entrySelector': 'article a', 'dateSelector': '.date',
        'locationSelector': '.where', 'licenseUrl': 'https://denvergov.org/terms',
        'authorityTier': 'city_government', 'attributes': {'authorityTier': 'city_government'},
    }
    body = '<article><a href="/ActivityRegistration/1"><span>Trail Cleanup</span>' \
           '<time class="date">2026-10-14</time><span class="where">Harvey Park</span></a></article>'
    result = acquire_review_package(
        'denver-html-replay',
        RegionalNeed('Denver, CO', 'denver', (FeatureRequirement('event'),)),
        [config], lambda _: body, AcquisitionLedger(tmp_path / 'ledger.sqlite3'), tmp_path / 'packages',
    )
    assert result['fallbackStatus'] == 'SUCCEEDED'
    assert result['package']['coverageMetrics']['acceptedRecords'] == 1
    record = result['package']['records'][0]['record']
    assert record['attributes']['location'] == 'Harvey Park'
    assert record['official_url'].endswith('/ActivityRegistration/1')
    gate = evaluate_review_package_gate(result['package'])
    assert gate['automatedReady'] is True


def test_portland_arcgis_layer_discovery_transfers_to_layer_ingestion():
    service = {'layers': [{'id': 12, 'name': 'Portland Parks'}, {'id': 1, 'name': 'Park Trails'}]}
    proposals = discover_arcgis_layers(
        service, 'https://www.portlandmaps.com/arcgis/rest/services/Public/Parks/MapServer',
        domains=('park', 'trail'),
    )
    assert len(proposals) == 2
    layer_config = {**proposals[0], 'propertyMapping': {'id': 'OBJECTID', 'name': 'NAME'}, 'category': 'park'}
    result = acquire(layer_config, lambda _: json.dumps({
        'objectIdFieldName': 'OBJECTID', 'features': [{
            'attributes': {'OBJECTID': 12, 'NAME': 'Portland Park'},
            'geometry': {'rings': [[[-122.7, 45.5], [-122.6, 45.5], [-122.6, 45.6], [-122.7, 45.5]]]},
        }],
    }))
    assert result.status == 'SUCCEEDED'
    assert result.records[0].name == 'Portland Park'


def test_portland_frontend_package_reaches_same_gate_as_denver(tmp_path):
    config = {
        'provider': 'geojson', 'url': 'https://www.portland.gov/open-data/places.geojson',
        'licenseUrl': 'https://www.portland.gov/terms', 'authorityTier': 'city_government',
        'domains': ['park', 'trail', 'library', 'history'],
        'propertyMapping': {'id': 'id', 'name': 'name', 'category': 'category'},
    }
    features = []
    for index, category in enumerate(('park', 'trail', 'library', 'history')):
        features.append({'type': 'Feature', 'id': category, 'properties': {
            'id': category, 'name': category.title(), 'category': category,
        }, 'geometry': {'type': 'Point', 'coordinates': [-122.60 - index * .01, 45.50 + index * .01]}})
    result = acquire_review_package(
        'portland-frontend-replay',
        RegionalNeed('Portland, OR', 'portland', tuple(FeatureRequirement(c) for c in ('park', 'trail', 'library', 'history'))),
        [config], lambda _: json.dumps({'features': features}),
        AcquisitionLedger(tmp_path / 'ledger.sqlite3'), tmp_path / 'packages',
    )
    package = result['package']
    gate = evaluate_review_package_gate(package)
    assert package['coverage']['gaps'] == []
    assert package['coverageMetrics']['acceptedRecords'] == 4
    assert gate['automatedReady'] is True


def test_chicago_ics_package_transfers_and_controlled_advance_once(tmp_path):
    config = {
        'provider': 'icalendar', 'url': 'https://www.chicago.gov/events.ics',
        'category': 'event', 'licenseUrl': 'https://www.chicago.gov/terms',
        'authorityTier': 'city_government',
        'attributes': {'authorityTier': 'city_government'},
    }
    body = (
        'BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:Chicago Events\n'
        'BEGIN:VEVENT\nUID:chi-1\nSUMMARY:Neighborhood Arts Walk\n'
        'DTSTART:20261014T160000Z\nDTEND:20261014T180000Z\n'
        'LAST-MODIFIED:20260921T120000Z\nLOCATION:Millennium Park\n'
        'URL:https://www.chicago.gov/events/chi-1\nEND:VEVENT\nEND:VCALENDAR\n'
    )
    result = acquire_review_package(
        'chicago-ics-replay', RegionalNeed('Chicago, IL', 'chicago', (FeatureRequirement('event'),)),
        [config], lambda _: body, AcquisitionLedger(tmp_path / 'ledger.sqlite3'), tmp_path / 'packages',
    )
    package = result['package']
    automated = evaluate_review_package_gate(package)
    assert result['fallbackStatus'] == 'SUCCEEDED'
    assert automated['automatedReady'] is True
    assert automated['canAdvance'] is False

    # One controlled transfer check: exercising the operator advancement flag
    # must not change the automated evidence or bypass failed checks.
    advanced = evaluate_review_package_gate(package, human_advanced=True)
    assert advanced['automatedReady'] is True
    assert advanced['canAdvance'] is True
    assert advanced['humanAdvanced'] is True


def test_four_region_promoted_candidates_reach_review_readiness(tmp_path):
    cases = [
        ('portland', 'Portland, OR', 'event', {
            'provider': 'icalendar', 'url': 'https://portland.gov/events.ics',
            'licenseUrl': 'https://portland.gov/terms', 'authorityTier': 'city_government',
        }, 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:p1\nSUMMARY:Portland Walk\n'
           'DTSTART:20261014T160000Z\nLOCATION:Waterfront\nEND:VEVENT\nEND:VCALENDAR\n'),
        ('denver', 'Denver, CO', 'park', {
            'provider': 'arcgis_feature_service', 'url': 'https://denver.gov/rest/services/Parks/FeatureServer/0',
            'licenseUrl': 'https://denvergov.org/terms', 'authorityTier': 'city_government',
            'category': 'park',
        }, {'objectIdFieldName': 'OBJECTID', 'features': [{'attributes': {'OBJECTID': 1, 'name': 'Denver Park'},
            'geometry': {'x': -104.99, 'y': 39.74}}]}),
        ('seattle', 'Seattle, WA', 'park', {
            'provider': 'ogc_records', 'url': 'https://seattle.gov/collections/parks/items',
            'licenseUrl': 'https://seattle.gov/terms', 'authorityTier': 'city_government',
            'category': 'park',
        }, {'features': [{'id': 's1', 'properties': {'name': 'Seattle Park'},
            'geometry': {'type': 'Point', 'coordinates': [-122.33, 47.61]}}]}),
        ('chicago', 'Chicago, IL', 'park', {
            'provider': 'socrata', 'url': 'https://data.chicago.gov/resource/parks.json',
            'licenseUrl': 'https://data.chicago.gov/terms', 'authorityTier': 'city_government',
            'category': 'park', 'paginate': False,
        }, '[{"id":"c1","name":"Chicago Park","latitude":"41.88","longitude":"-87.63"}]'),
    ]
    for region_id, region_name, category, config, body in cases:
        result = acquire_review_package(
            f'{region_id}-promoted-replay', RegionalNeed(region_name, region_id, (FeatureRequirement(category),)),
            [config], lambda _, body=body: json.dumps(body) if isinstance(body, dict) else body,
            AcquisitionLedger(tmp_path / f'{region_id}.sqlite3'), tmp_path / 'packages',
        )
        gate = evaluate_review_package_gate(result['package'])
        assert result['fallbackStatus'] == 'SUCCEEDED'
        assert result['package']['coverage']['gaps'] == []
        assert result['package']['sourceMetadata']
        assert gate['automatedReady'] is True
