import json
from pathlib import Path

def test_boise_watershed_volunteer_event_is_explicit():
    root = Path(__file__).parents[1]
    package = json.loads((root / "motherbird/regions/boise-meridian-idaho/civic/index.json").read_text(encoding="utf-8"))
    item = next(item for item in package["artifacts"]["volunteer"]["items"] if item["id"] == "boise-watershed-volunteer:3161:2026-10-14")
    assert item["startsAt"].startswith("2026-10-14T10:00:00")
    assert item["venueAddress"] == "1262 Exchange St, Boise, ID"
    assert item["participation"]["whatYouWillDo"]
    assert item["source"]["url"] == "https://www.boisewatershed.org/about/volunteer/"
