import json
from pathlib import Path

def test_maine_public_event_is_explicit_and_official():
    root = Path(__file__).parents[1]
    package = json.loads((root / "motherbird/regions/portland-maine/civic/index.json").read_text(encoding="utf-8"))
    item = next(item for item in package["artifacts"]["events"]["items"] if item["id"] == "maine-public:collins-center-maxwell-quartet:2026-10-25")
    assert item["startsAt"].startswith("2026-10-25T15:00:00")
    assert item["endsAt"].startswith("2026-10-25T16:30:00")
    assert item["venueAddress"] == "Minsky Recital Hall, Orono, ME"
    assert item["officialUrl"].startswith("https://www.mainepublic.org/community-calendar/event/")
