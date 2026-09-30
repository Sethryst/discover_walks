import json
from pathlib import Path

def test_seattle_calendar_records_are_explicit_and_official():
    root = Path(__file__).parents[1]
    package = json.loads((root / "motherbird/regions/seattle/civic/index.json").read_text(encoding="utf-8"))
    items = [item for item in package["artifacts"]["events"]["items"] if item["id"].startswith("seattle-trumba:")]
    assert len(items) >= 20
    assert all(item["startsAt"] >= "2026-09-30T00:00:00" for item in items)
    assert all(item["venueAddress"] and item["officialUrl"].startswith("https://www.seattle.gov/") for item in items)
