import json
from pathlib import Path

def test_downtown_norfolk_events_are_static_and_explicit():
    root = Path(__file__).parents[1]
    package = json.loads((root / "motherbird/regions/norfolk/civic/index.json").read_text(encoding="utf-8"))
    expected = {"downtown-norfolk:womens-leadership-and-self-care-summit:2026-09-30", "downtown-norfolk:business-underground:2026-10-01", "downtown-norfolk:unleash-2026:2026-10-02"}
    items = [item for item in package["artifacts"]["events"]["items"] if item["id"] in expected]
    assert {item["id"] for item in items} == expected
    for item in items:
        assert "T" in item["startsAt"] and "T" in item["endsAt"]
        assert item["venueAddress"]
        assert item["officialUrl"].startswith("https://www.downtownnorfolk.org/event/")
