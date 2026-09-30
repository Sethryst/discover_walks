"""Add a verified Downtown Denver Partnership JSON-LD event."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/denver/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    events = payload["artifacts"]["events"]
    events["generatedAt"] = payload["generatedAt"]
    record = {"date":"2026-09-30","endsAt":"2026-09-30T14:00:00-06:00","expiresAt":"2026-10-01T06:00:00Z","id":"downtowndenver:civic-center-eats-9-30-2026","locationLabel":"Civic Center Park Great Lawn, 101 W 14th Ave, Denver, CO 80204","officialUrl":"https://www.downtowndenver.com/event-details/civic-center-eats-9-30-2026","source":{"authorityTier":"civic_organization","name":"Downtown Denver Partnership","reviewStatus":"verified","url":"https://www.downtowndenver.com/event-list"},"startsAt":"2026-09-30T11:00:00-06:00","summary":"Civic Center EATS with food trucks and musical entertainment at Bannock Street and the Civic Center Park Great Lawn.","title":"Civic Center EATS 9/30/2026","venueAddress":"Civic Center Park Great Lawn, 101 W 14th Ave, Denver, CO 80204"}
    if record["id"] not in {x["id"] for x in events["items"]}: events["items"].append(record)
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "events-downtown-denver-com-920db7f3":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 1 dated/location-backed event from the official Downtown Denver Partnership event detail JSON-LD, with canonical slug and checked 2026-09-29."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__": main()
