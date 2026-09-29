from .adapters import AdapterResult, acquire, acquire_socrata_pages, arcgis_query_params, discover_arcgis_layers, parse_arcgis, parse_feed, parse_html_directory, parse_icalendar_events, parse_jsonld_events, parse_ogc_records, parse_socrata, socrata_page_params, source_health
from .quality import freshness_score
from datetime import date


def test_arcgis_service_root_becomes_proposed_layer_sources():
    rows = discover_arcgis_layers(
        {'layers': [{'id': 4, 'name': 'Parks'}, {'id': 1, 'name': 'Trails'}]},
        'https://example.gov/arcgis/rest/services/Public/Parks/MapServer',
        domains=('park', 'trail'),
    )
    assert [row['url'] for row in rows] == [
        'https://example.gov/arcgis/rest/services/Public/Parks/MapServer/1',
        'https://example.gov/arcgis/rest/services/Public/Parks/MapServer/4',
    ]
    assert all(row['status'] == 'PROPOSED' for row in rows)
    assert all(row['domains'] == ['park', 'trail'] for row in rows)


def test_arcgis_query_uses_metadata_limit_and_geojson_when_available():
    params = arcgis_query_params({'maxRecordCount': 2000, 'supportedQueryFormats': 'JSON,geoJSON'}, offset=2000)
    assert params['resultRecordCount'] == '2000'
    assert params['resultOffset'] == '2000'
    assert params['outSR'] == '4326'
    assert params['f'] == 'geojson'


def test_arcgis_polygon_gets_representative_coordinate():
    result = parse_arcgis({
        'features': [{
            'attributes': {'OBJECTID': 7, 'NAME': 'Park'},
            'geometry': {'rings': [[[-123.0, 45.0], [-122.0, 45.0], [-122.0, 46.0], [-123.0, 45.0]]]},
        }]
    }, {'url': 'https://example.gov/parks/0', 'propertyMapping': {'id': 'OBJECTID', 'name': 'NAME'}, 'category': 'park'})
    assert result.records[0].longitude == -122.5
    assert result.records[0].latitude == 45.25


def test_source_health_preserves_status_counts_and_errors():
    result = AdapterResult('geojson', 'https://example.gov/data', 'PARTIAL', errors=('missing name',))
    assert source_health(result) == {
        'provider': 'geojson', 'url': 'https://example.gov/data', 'status': 'PARTIAL',
        'recordCount': 0, 'errorCount': 1, 'errors': ['missing name'], 'rawSha256': None, 'metadata': {},
    }


def test_adapter_constants_preserve_authority_and_update_fields():
    result = acquire({
        'url': 'https://city.gov/parks', 'domains': ['parks'],
        'propertyMapping': {'id': 'id', 'name': 'name', 'updatedAt': 'updated',
                            'constants': {'authorityTier': 'city_government'}},
    }, lambda _: '{"features":[{"properties":{"id":"p1","name":"Park","updated":"2026-09-01"},"geometry":{"type":"Point","coordinates":[-122.6,45.5]}}]}')
    assert result.records[0].source_updated_at == '2026-09-01'
    assert result.records[0].attributes['authorityTier'] == 'city_government'


def test_freshness_score_uses_age_bands_and_reports_stale_data():
    assert freshness_score('2026-09-01', today=date(2026, 9, 28))[0] == 1.0
    score, note = freshness_score('2024-01-01', today=date(2026, 9, 28))
    assert score == 0.25 and 'stale' in note
    assert freshness_score('not-a-date', today=date(2026, 9, 28))[0] == 0.25


def test_rss_adapter_preserves_entry_identity_and_official_link():
    result = parse_feed(
        '<rss version="2.0"><channel><item><guid>e1</guid><title>Free Walk</title>'
        '<link>https://city.gov/events/e1</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>'
        '</item></channel></rss>',
        {'url': 'https://city.gov/events.rss', 'category': 'event'},
    )
    assert result.status == 'SUCCEEDED'
    assert result.records[0].record_id == 'e1'
    assert result.records[0].official_url == 'https://city.gov/events/e1'


def test_socrata_adapter_maps_tabular_rows():
    result = parse_socrata('[{"id":"l1","name":"Central Library","latitude":"45.5","longitude":"-122.6"}]',
                           {'url': 'https://data.example/resource/abc.json', 'category': 'library'})
    assert result.status == 'SUCCEEDED'
    assert result.records[0].latitude == 45.5
    assert result.records[0].canonical_category == 'library'


def test_html_directory_adapter_extracts_linked_entries():
    result = parse_html_directory('<main><a data-id="p1" href="https://city.gov/parks/p1">River Park</a></main>',
                                  {'url': 'https://city.gov/parks', 'category': 'park'})
    assert result.status == 'SUCCEEDED'
    assert result.records[0].official_url.endswith('/p1')


def test_html_directory_resolves_relative_official_links():
    result = parse_html_directory('<a href="/library/central">Central Library</a>',
                                  {'url': 'https://multcolib.org/hours-and-locations', 'category': 'library'})
    assert result.records[0].official_url == 'https://multcolib.org/library/central'


def test_html_directory_extracts_configured_event_date_and_location():
    result = parse_html_directory(
        '<article><a href="/e1"><span class="title">Trail Cleanup</span>'
        '<time class="date">2026-10-14</time><span class="where">Harvey Park</span></a></article>',
        {'url': 'https://denver.gov/events', 'category': 'event', 'entrySelector': 'article a',
         'dateSelector': '.date', 'locationSelector': '.where'},
    )
    assert result.records[0].attributes['start'] == '2026-10-14'
    assert result.records[0].attributes['location'] == 'Harvey Park'


def test_socrata_pagination_is_stable_and_validates_bounds():
    assert socrata_page_params(offset=1000, limit=500, order=':id') == {
        '$limit': '500', '$offset': '1000', '$order': ':id'
    }
    try:
        socrata_page_params(offset=-1)
    except ValueError as exc:
        assert 'non-negative' in str(exc)
    else:
        raise AssertionError('negative offset should fail')


def test_socrata_page_acquisition_merges_until_short_page():
    calls = []
    def transport(url):
        calls.append(url)
        if '%24offset=0' in url:
            return '[{"id":"a","name":"A"},{"id":"b","name":"B"}]'
        return '[{"id":"c","name":"C"}]'
    result = acquire_socrata_pages({'url': 'https://data.example/resource/x.json', 'category': 'park'}, transport, page_size=2)
    assert result.status == 'SUCCEEDED'
    assert [row.record_id for row in result.records] == ['a', 'b', 'c']
    assert len(calls) == 2


def test_acquire_dispatches_paginated_socrata_provider():
    calls = []
    def transport(url):
        calls.append(url)
        return '[{"id":"a","name":"A"}]'
    result = acquire({'provider': 'socrata', 'url': 'https://data.example/resource/x.json',
                      'category': 'park', 'pageSize': 2}, transport)
    assert result.status == 'SUCCEEDED'
    assert len(result.records) == 1
    assert len(calls) == 1


def test_paginated_socrata_health_contains_page_metadata():
    result = acquire_socrata_pages({'url': 'https://data.example/x.json', 'category': 'park'},
                                   lambda _: '[{"id":"a","name":"A"}]', page_size=2)
    health = source_health(result)
    assert health['metadata']['pagesAttempted'] == 1
    assert health['metadata']['stoppedOnShortPage'] is True


def test_ogc_records_adapter_reuses_geojson_feature_contract():
    result = parse_ogc_records({'features': [{
        'id': 'park-1', 'properties': {'name': 'Catalog Park'},
        'geometry': {'type': 'Point', 'coordinates': [-122.6, 45.5]},
    }]}, {'url': 'https://gis-pdx.opendata.arcgis.com/api/search/v1/collections/parks/items',
           'category': 'park', 'catalog': 'portland-ogc', 'collection': 'parks'})
    assert result.status == 'SUCCEEDED'
    assert result.provider == 'ogc_records'
    assert result.records[0].name == 'Catalog Park'


def test_jsonld_event_adapter_extracts_event_identity_time_and_location():
    result = parse_jsonld_events(
        '<script type="application/ld+json">{"@type":"Event","name":"Park Concert",'
        '"url":"https://city.gov/events/1","startDate":"2026-09-27T18:00:00Z",'
        '"endDate":"2026-09-27T20:00:00Z",'
        '"location":{"name":"City Park","geo":{"latitude":45.5,"longitude":-122.6}}}</script>',
        {'url': 'https://city.gov/events', 'attributes': {'authorityTier': 'city_government'}},
    )
    assert result.status == 'SUCCEEDED'
    assert result.records[0].official_url.endswith('/1')
    assert result.records[0].attributes['location'] == 'City Park'
    assert result.records[0].attributes['end'] == '2026-09-27T20:00:00Z'


def test_icalendar_adapter_preserves_uid_timing_location_and_last_modified():
    result = parse_icalendar_events(
        'BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:City Events\nBEGIN:VEVENT\n'
        'UID:event-42\nSUMMARY:Neighborhood Cleanup\nDTSTART:20261014T160000Z\n'
        'DTEND:20261014T180000Z\nDTSTAMP:20260920T120000Z\n'
        'LAST-MODIFIED:20260921T120000Z\nLOCATION:Harvey Park\n'
        'URL:https://city.gov/events/42\nEND:VEVENT\nEND:VCALENDAR\n',
        {'url': 'https://city.gov/events.ics'},
    )
    assert result.status == 'SUCCEEDED'
    assert result.records[0].record_id == 'event-42'
    assert result.records[0].official_url.endswith('/42')
    assert result.records[0].attributes['location'] == 'Harvey Park'
    assert result.metadata['eventCount'] == 1
