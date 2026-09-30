"""Integrate current SF Recreation & Parks events from official iCalendar feeds."""
import html
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/san-francisco/civic/index.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
AUDIT = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
PAGE = "https://sfrecpark.org/iCalendar.aspx"
BASE = "https://sfrecpark.org"


def fetch(url):
    return urlopen(Request(url, headers={"User-Agent": "GremlinLab-static-source-review/1.0"}), timeout=30).read().decode("utf-8", errors="replace")


def fields(block):
    unfolded = re.sub(r"\r?\n[ \t]", "", block)
    result = {}
    for line in unfolded.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.split(";", 1)[0].upper()] = value.strip()
    return result


def main():
    page = fetch(PAGE)
    feeds = sorted(set(re.findall(r"https://sfrecpark\.org/common/modules/iCalendar/iCalendar\.aspx\?catID=\d+&feed=calendar", page)))
    now = datetime(2026, 9, 30, tzinfo=ZoneInfo("America/Los_Angeles"))
    records = []
    for feed in feeds:
        for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", fetch(feed), re.S):
            f = fields(block)
            if not f.get("UID") or not f.get("DTSTART") or not f.get("SUMMARY") or not f.get("LOCATION"):
                continue
            location = " ".join(html.unescape(f["LOCATION"]).split())
            if location.startswith("-") or not re.search(r"San Francisco|CA", location, re.I):
                continue
            start_text = re.sub(r"[^0-9]", "", f["DTSTART"])
            if len(start_text) < 8:
                continue
            start = datetime.strptime(start_text[:14], "%Y%m%d%H%M%S").replace(tzinfo=ZoneInfo("America/Los_Angeles"))
            if start < now:
                continue
            end = None
            if f.get("DTEND"):
                end_text = re.sub(r"[^0-9]", "", f["DTEND"])
                if len(end_text) >= 14:
                    end = datetime.strptime(end_text[:14], "%Y%m%d%H%M%S").replace(tzinfo=ZoneInfo("America/Los_Angeles"))
            official = f.get("DESCRIPTION", "").strip()
            if not official.startswith("http"):
                official = f"{BASE}/calendar.aspx?EID={f['UID']}"
            records.append({"id": f"sfrecpark-ical:{f['UID']}", "title": html.unescape(f["SUMMARY"]), "date": start.date().isoformat(), "startsAt": start.isoformat(), "endsAt": end.isoformat() if end else None, "expiresAt": f"{start.date().isoformat()}T23:59:59-07:00", "locationLabel": location, "venueAddress": location, "officialUrl": official, "summary": f"{html.unescape(f['SUMMARY'])} listed in the official San Francisco Recreation & Parks calendar.", "source": {"authorityTier": "local_government", "name": "San Francisco Recreation & Parks", "reviewStatus": "verified", "url": PAGE}})
    unique = {row["id"]: row for row in records}
    if not unique:
        raise SystemExit("No current location-backed official SF Rec & Parks iCalendar records")
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    items = payload["artifacts"]["events"]["items"]
    existing = {item["id"] for item in items}
    items.extend(row for row in unique.values() if row["id"] not in existing)
    payload["generatedAt"] = "2026-09-30T00:00:00Z"
    payload["artifacts"]["events"]["generatedAt"] = payload["generatedAt"]
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for row in backlog.get("retiredCandidates", []):
        if row["sourceId"] in {"events-sfrecpark-org-ddd118f6", "events-sfrecpark-org-822dab73"}:
            row["status"] = "INTEGRATED_STATIC"
            row["evidence"] = f"Official SF Recreation & Parks iCalendar subscription directory exposed {len(unique)} current/future events with UID, explicit local date/time, location, and canonical EID URLs; records published to the San Francisco civic package."
            row["nextAcquisitionPath"] = None
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    for row in audit["results"]:
        if row["sourceId"] == "events-sfrecpark-org-ddd118f6":
            row.update({"replacementUrl": PAGE, "status": "INTEGRATED_STATIC", "evidence": f"Official SF Recreation & Parks iCalendar subscription directory exposed {len(unique)} current/future events with UID, explicit local date/time, location, and canonical EID URLs; records published to the San Francisco civic package.", "nextAcquisitionPath": None})
    if not any(row["sourceId"] == "events-sfrecpark-org-822dab73" for row in audit["results"]):
        audit["results"].append({"sourceId": "events-sfrecpark-org-822dab73", "replacementUrl": PAGE, "status": "INTEGRATED_STATIC", "evidence": f"Official SF Recreation & Parks iCalendar subscription directory exposed {len(unique)} current/future events with UID, explicit local date/time, location, and canonical EID URLs; records published to the San Francisco civic package.", "nextAcquisitionPath": None})
    audit["results"].sort(key=lambda row: row["sourceId"])
    AUDIT.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"feeds": len(feeds), "records": len(unique)}))


if __name__ == "__main__":
    main()
