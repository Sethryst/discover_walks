"""Add a verified Denver City Council Legistar meeting to the static civic package."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/denver/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"

def main():
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    payload["generatedAt"] = "2026-09-29T23:59:00Z"
    events = payload["artifacts"].setdefault("events", {"generatedAt": payload["generatedAt"], "items": [], "producer": {"name": "Gremlin Lab", "version": "static-source-resolution"}, "regionId": "denver", "schemaVersion": 1})
    events["generatedAt"] = payload["generatedAt"]
    record = {"date":"2026-09-29","endsAt":"2026-09-29T15:30:00-06:00","expiresAt":"2026-09-30T06:00:00Z","id":"denver-legistar:1447175:2026-09-29","locationLabel":"City & County Building, Room 391, Denver, CO","officialUrl":"https://denver.legistar.com/MeetingDetail.aspx?ID=1447175&GUID=58EF1F8F-579E-4A86-80CD-1748E731D17D","source":{"authorityTier":"local_government","name":"City and County of Denver","reviewStatus":"verified","url":"https://denver.legistar.com/Calendar.aspx"},"startsAt":"2026-09-29T13:30:00-06:00","summary":"Community Planning and Housing meeting listed in the official Denver Legistar calendar.","title":"Community Planning and Housing","venueAddress":"City & County Building, Room 391, 1437 Bannock Street, Denver, CO"}
    if record["id"] not in {x["id"] for x in events["items"]}: events["items"].append(record)
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "meetings-denvergov-org-461d818b":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published 1 dated/location-backed Denver meeting from the official Denver Legistar calendar and meeting-detail URL; checked 2026-09-29."
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED_ACTIONABLE")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = backlog["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__": main()
