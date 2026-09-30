"""Add a verified Richmond, Virginia City Council Legistar meeting."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/richmond/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    events = payload["artifacts"].setdefault("events", {"generatedAt": payload["generatedAt"], "items": [], "producer": {"name": "Gremlin Lab", "version": "static-source-resolution"}, "regionId": "richmond", "schemaVersion": 1})
    events["generatedAt"] = payload["generatedAt"]
    record = {"date":"2026-09-28","endsAt":"2026-09-28T20:00:00-04:00","expiresAt":"2026-09-29T04:00:00Z","id":"richmond-legistar:1354767:2026-09-28","locationLabel":"Council Chamber, 2nd Floor - City Hall, Richmond, VA","officialUrl":"https://richmondva.legistar.com/MeetingDetail.aspx?ID=1354767&GUID=A1E8F936-2014-4EE7-934B-E47C3001605A&Options=info|&Search=","source":{"authorityTier":"local_government","name":"City of Richmond","reviewStatus":"verified","url":"https://richmondva.legistar.com/Calendar.aspx"},"startsAt":"2026-09-28T18:00:00-04:00","summary":"City Council meeting listed in the official City of Richmond Legistar calendar.","title":"City Council","venueAddress":"Council Chamber, 2nd Floor - City Hall, 900 E. Broad Street, Richmond, VA 23219"}
    if record["id"] not in {x["id"] for x in events["items"]}: events["items"].append(record)
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "meetings-richmondgov-com-87666ac9":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 1 dated/location-backed Richmond City Council record from the official Legistar calendar and meeting-detail URL; checked 2026-09-29."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__": main()
