"""Add a verified Philadelphia City Council Legistar meeting."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/philadelphia/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    events = payload["artifacts"]["events"]["items"]
    record = {"date":"2026-09-24","endsAt":"2026-09-24T11:00:00-04:00","expiresAt":"2026-09-25T04:00:00Z","id":"phila-legistar:1442898:2026-09-24","locationLabel":"Room 400, City Hall, Philadelphia, PA","officialUrl":"https://phila.legistar.com/MeetingDetail.aspx?ID=1442898&GUID=ACD148AB-8666-4AFC-8843-8367D608AD88&Options=info|&Search=","source":{"authorityTier":"local_government","name":"City of Philadelphia","reviewStatus":"verified","url":"https://phila.legistar.com/Calendar.aspx"},"startsAt":"2026-09-24T10:00:00-04:00","summary":"CITY COUNCIL meeting listed in the official Philadelphia Legistar calendar.","title":"CITY COUNCIL","venueAddress":"Room 400, City Hall, Philadelphia, PA"}
    if record["id"] not in {x["id"] for x in events}: events.append(record)
    payload["artifacts"]["events"]["generatedAt"] = payload["generatedAt"]
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "meetings-phila-gov-a4cb56f4":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 1 dated/location-backed Philadelphia City Council record from the official Legistar calendar and meeting-detail URL; checked 2026-09-29."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__": main()
