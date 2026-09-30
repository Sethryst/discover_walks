import json
from pathlib import Path

def test_boise_public_radio_event_is_explicit_and_official():
    root = Path(__file__).parents[1]
    package = json.loads((root / "motherbird/regions/boise-meridian-idaho/civic/index.json").read_text(encoding="utf-8"))
    item = next(item for item in package["artifacts"]["events"]["items"] if item["id"] == "boise-public-radio:art-show-in-pursuit-of-light:2026-10-01")
    assert item["startsAt"].startswith("2026-10-01T17:00:00")
    assert item["venueAddress"] == "Idaho Art Gallery, 702 W Idaho St #105, Boise, ID"
    assert item["officialUrl"].startswith("https://www.boisestatepublicradio.org/community-calendar-search/event/")
