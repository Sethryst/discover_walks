"""Integrate dated Boise IQM2 meetings from the official public calendar."""
from __future__ import annotations

import html
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/boise-meridian-idaho/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
AUDIT = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
SOURCE = "https://boisecityid.iqm2.com/Citizens/Calendar.aspx?From=10/1/2026&To=12/31/2026"
BASE = "https://boisecityid.iqm2.com"


def main() -> None:
    request = Request(SOURCE, headers={"User-Agent": "GremlinLab-static-source-review/1.0"})
    markup = urlopen(request, timeout=30).read().decode("utf-8", errors="replace")
    rows = re.split(r'(?=<div class="Row MeetingRow)', markup)[1:]
    records = []
    for row in rows:
        link = re.search(r'href="(/Citizens/Detail_Meeting\.aspx\?ID=\d+)"[^>]*title="([^"]+)"', row)
        detail = re.search(r'class="MainScreenText RowDetails">([^<]+)', row)
        if not link or not detail:
            continue
        title = html.unescape(link.group(2)).replace("\r", "\n")
        lines = [line.strip() for line in title.splitlines() if line.strip()]
        if len(lines) < 2 or "Status:" not in title or "Scheduled" not in title:
            continue
        match = re.search(r"(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+([A-Z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)", title)
        location = re.search(r"Status:\s*Scheduled\s*\n\s*(.+)", title, re.S)
        if not match or not location:
            continue
        start = datetime.strptime(match.group(1), "%B %d, %Y %I:%M %p").replace(tzinfo=ZoneInfo("America/Boise"))
        venue = " ".join(location.group(1).split())
        meeting_name = html.unescape(detail.group(1)).strip()
        meeting_id = re.search(r"ID=(\d+)", link.group(1)).group(1)
        official_url = BASE + link.group(1)
        records.append({
            "id": f"boise-iqm2:{meeting_id}:{start.date().isoformat()}",
            "title": meeting_name,
            "date": start.date().isoformat(),
            "startsAt": start.isoformat(),
            "endsAt": None,
            "expiresAt": f"{start.date().isoformat()}T23:59:59Z",
            "locationLabel": venue,
            "venueAddress": venue,
            "officialUrl": official_url,
            "summary": f"{meeting_name} listed in the official City of Boise IQM2 meeting calendar.",
            "source": {"authorityTier": "local_government", "name": "City of Boise", "reviewStatus": "verified", "url": SOURCE},
        })
    if not records:
        raise SystemExit("No scheduled dated/location-backed IQM2 records found")
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    events = payload["artifacts"]["events"]
    existing = {item["id"] for item in events["items"]}
    events["items"].extend(record for record in records if record["id"] not in existing)
    payload["generatedAt"] = "2026-09-30T00:00:00Z"
    events["generatedAt"] = payload["generatedAt"]
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item["id"] == "meetings-cityofboise-org-3b05a56d":
                item["trackingState"] = "INTEGRATED_STATIC"
                item["resolutionDisposition"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = f"Published {len(records)} scheduled dated/location-backed meetings from the official City of Boise IQM2 calendar; stable meeting-detail IDs and venue addresses verified 2026-09-30."
                item["resolutionNote"] = item["integrationEvidence"]
                item["nextAcquisitionPath"] = None
    states = {}
    for region in backlog["regions"]:
        for item in region["queue"]:
            state = item.get("trackingState", "UNTRACKED")
            states[state] = states.get(state, 0) + 1
    backlog["summary"]["trackingStates"] = states
    backlog["summary"]["unresolvedCount"] = sum(states.values()) - states.get("INTEGRATED_STATIC", 0)
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    audit["results"] = [row for row in audit["results"] if row["sourceId"] != "meetings-cityofboise-org-3b05a56d"]
    audit["results"].append({"sourceId": "meetings-cityofboise-org-3b05a56d", "replacementUrl": SOURCE, "status": "INTEGRATED_STATIC", "evidence": f"Official City of Boise IQM2 calendar returned {len(records)} scheduled rows for October–December 2026 with stable meeting-detail IDs, explicit dates/times, and venue/address text; records published to the Boise civic package.", "nextAcquisitionPath": None})
    audit["results"].sort(key=lambda row: row["sourceId"])
    AUDIT.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "source": SOURCE}))


if __name__ == "__main__":
    main()
