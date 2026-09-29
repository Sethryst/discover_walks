import json
from gremlin_acquisition.source_discovery import discover_html, verify_structured_schema

def test_html_discovery_finds_jsonld_feed_and_selector_without_publishing():
    html = '''<article class="calendar-event"><script type="application/ld+json">{"@type":"Event","name":"Walk","startDate":"2026-10-01T12:00:00Z"}</script><a href="/events.ics">iCal</a></article>'''
    result = discover_html("x", "https://example.test/calendar", html)
    assert result.jsonld_events == 1
    assert result.candidate_endpoints == ("https://example.test/events.ics",)
    assert result.selector_candidates == ("article.calendar-event",)
    assert result.blocker is None

def test_structured_schema_probe_accepts_replay_records():
    config = {"provider": "geojson", "url": "https://example.test/pois.json", "category": "park", "propertyMapping": {"id": "id", "name": "name"}}
    body = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "p1", "properties": {"id": "p1", "name": "Park"}, "geometry": {"type": "Point", "coordinates": [-77.1, 38.9]}}]}
    result = verify_structured_schema("x", config, lambda _: json.dumps(body))
    assert result.schema_status == "schema-valid"

def test_html_discovery_adds_civicplus_calendar_fallbacks():
    html = '<div data-calendar="Home/Components/Calendar"></div>'
    result = discover_html("x", "https://city.example.gov/events", html)
    assert "https://city.example.gov/Home/Components/Calendar/GetCalendarEvents" in result.candidate_endpoints
    assert "https://city.example.gov/Home/Components/Calendar/Calendar" in result.candidate_endpoints

def test_html_discovery_extracts_widget_feed_attributes():
    html = '<div data-api-url="/api/events.json"></div><script>eventSources: "https://feed.example/events.ics"</script>'
    result = discover_html("x", "https://city.example.gov/events", html)
    assert "https://city.example.gov/api/events.json" in result.candidate_endpoints
    assert "https://feed.example/events.ics" in result.candidate_endpoints
