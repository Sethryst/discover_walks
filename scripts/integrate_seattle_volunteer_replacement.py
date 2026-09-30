"""Publish verified Seattle Parks volunteer events from the official Trumba ICS export."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/seattle/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    events = payload["artifacts"]["events"]["items"]
    source = {"authorityTier":"local_government","name":"Seattle Parks and Recreation","reviewStatus":"verified","url":"https://www.trumba.com/calendars/parks-recreation.ics"}
    records = [
        {"date":"2026-09-29","endsAt":"2026-09-29T13:00:00-07:00","expiresAt":"2026-09-30T07:00:00Z","id":"seattle-trumba:206379716:2026-09-29","locationLabel":"Admiral Way & 37th Ave SW, Seattle, WA 98126","officialUrl":"https://www.seattle.gov/parks/recreation/events-and-attractions/park-activation-events?trumbaEmbed=view%3Devent%26eventid%3D206379716","source":source,"startsAt":"2026-09-29T10:00:00-07:00","summary":"Volunteer restoration work party at Duwamish Head Greenbelt, listed in the Seattle Parks public calendar.","title":"Duwamish Head Greenbelt Restoration","venueAddress":"Admiral Way & 37th Ave SW, Seattle, WA 98126"},
        {"date":"2026-10-01","endsAt":"2026-10-01T12:00:00-07:00","expiresAt":"2026-10-02T07:00:00Z","id":"seattle-trumba:209131473:2026-10-01","locationLabel":"8th Ave NE & NE 105th St, Seattle, WA 98125","officialUrl":"https://www.seattle.gov/parks/recreation/events-and-attractions/park-activation-events?trumbaEmbed=view%3Devent%26eventid%3D209131473","source":source,"startsAt":"2026-10-01T10:00:00-07:00","summary":"Volunteer restoration work party at Beaver Pond Natural Area, listed in the Seattle Parks public calendar.","title":"Fall Back to Beaver Pond Natural Area","venueAddress":"8th Ave NE & NE 105th St, Seattle, WA 98125"}
    ]
    existing = {x["id"] for x in events}
    events.extend(x for x in records if x["id"] not in existing)
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    payload["artifacts"]["events"]["generatedAt"] = payload["generatedAt"]
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "volunteer-seattle-gov-c1758f69":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 2 dated/location-backed Seattle Parks volunteer records from the official Trumba ICS export, with stable event UIDs and checked 2026-09-29."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
