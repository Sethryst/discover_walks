from app.pipeline.adapters.rss_ics_events import _parse_ics
def test_ics_preserves_explicit_location():
    rows=_parse_ics('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nSUMMARY:Library walk\nDTSTART:20990101T120000Z\nLOCATION:123 Main St\nEND:VEVENT\nEND:VCALENDAR')
    assert rows[0]['venueAddress']=='123 Main St'
