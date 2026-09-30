"""Add a verified New Orleans City Council Legistar meeting."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/new-orleans/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    events = payload["artifacts"].setdefault("events", {"generatedAt": payload["generatedAt"], "items": [], "producer": {"name": "Gremlin Lab", "version": "static-source-resolution"}, "regionId": "new-orleans", "schemaVersion": 1})
    events["generatedAt"] = payload["generatedAt"]
    record = {"date":"2026-09-17","endsAt":"2026-09-17T12:03:00-05:00","expiresAt":"2026-09-18T05:00:00Z","id":"new-orleans-legistar:1428857:2026-09-17","locationLabel":"City Hall Council Chamber, New Orleans, LA","officialUrl":"https://cityofno.legistar.com/View.ashx?M=IC&ID=1428857&GUID=5ABFBAA2-3BCA-442D-B19B-D32CD42E1050","source":{"authorityTier":"local_government","name":"City of New Orleans","reviewStatus":"verified","url":"https://cityofno.legistar.com/Calendar.aspx"},"startsAt":"2026-09-17T10:03:00-05:00","summary":"City Council meeting listed in the official City of New Orleans Legistar calendar.","title":"City Council","venueAddress":"City Hall Council Chamber, New Orleans, LA"}
    if record["id"] not in {x["id"] for x in events["items"]}: events["items"].append(record)
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "meetings-nola-gov-b2493356":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 1 dated/location-backed New Orleans City Council record from the official Legistar calendar/iCalendar URL; checked 2026-09-29."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__": main()
