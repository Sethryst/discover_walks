"""Add the verified Prince George's County Legistar meeting records to the static package."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/prince-georges-county/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    events = payload["artifacts"]["events"]["items"]
    records = [
        {"date":"2026-09-29","endsAt":"2026-09-29T15:00:00-04:00","expiresAt":"2026-09-30T04:00:00Z","id":"pgc-legistar:1396744:2026-09-29","locationLabel":"Committee Room 2027, Prince George's County Administration Building","officialUrl":"https://princegeorgescountymd.legistar.com/MeetingDetail.aspx?ID=1396744&GUID=473E5FC1-E0DF-4FF0-8EDA-E05F326DF5A9","source":{"authorityTier":"local_government","name":"Prince George's County Council","reviewStatus":"verified","url":"https://princegeorgescountymd.legistar.com/Calendar.aspx"},"startsAt":"2026-09-29T12:00:00-04:00","summary":"County Council meeting listed in the official Legistar calendar.","title":"Prince George's County Council","venueAddress":"Committee Room 2027, Prince George's County Administration Building"},
        {"date":"2026-09-29","endsAt":"2026-09-29T16:30:00-04:00","expiresAt":"2026-09-30T05:00:00Z","id":"pgc-legistar:1439452:2026-09-29","locationLabel":"Committee Room 2027, Prince George's County Administration Building","officialUrl":"https://princegeorgescountymd.legistar.com/MeetingDetail.aspx?ID=1439452&GUID=4CD9C9D2-0AEB-4239-8033-046EC6489046","source":{"authorityTier":"local_government","name":"Prince George's County Council","reviewStatus":"verified","url":"https://princegeorgescountymd.legistar.com/Calendar.aspx"},"startsAt":"2026-09-29T13:30:00-04:00","summary":"Committee of the Whole meeting listed in the official Legistar calendar.","title":"Sitting as the Committee of the Whole","venueAddress":"Committee Room 2027, Prince George's County Administration Building"}
    ]
    existing = {x["id"] for x in events}
    events.extend(x for x in records if x["id"] not in existing)
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    payload["artifacts"]["events"]["generatedAt"] = payload["generatedAt"]
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "meetings-princegeorgescountymd-gov-95ea3f6d":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 2 future/current dated and location-backed Prince George's County Council records from the official Legistar calendar and meeting-detail URLs; checked 2026-09-29."
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
