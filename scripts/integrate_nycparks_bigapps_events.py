"""Integrate the official NYC Parks upcoming-14-days JSON feed."""
import json
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "motherbird/regions/new-york-city/civic/index.json"
AUDIT = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
FEED = "https://www.nycgovparks.org/xml/events_300_rss.json"

def main():
    raw = urlopen(Request(FEED, headers={"User-Agent": "GremlinLab-static-source-review/1.0"}), timeout=30).read()
    rows = json.loads(raw.decode("utf-8"))
    now = datetime(2026, 9, 30, tzinfo=ZoneInfo("America/New_York"))
    records = []
    for row in rows:
        if not all(row.get(key) for key in ("guid", "title", "startdate", "starttime", "endtime", "location", "link")):
            continue
        try:
            start = datetime.strptime(f"{row['startdate']} {row['starttime']}", "%Y-%m-%d %I:%M %p").replace(tzinfo=ZoneInfo("America/New_York"))
            end = datetime.strptime(f"{row['enddate']} {row['endtime']}", "%Y-%m-%d %I:%M %p").replace(tzinfo=ZoneInfo("America/New_York"))
        except ValueError:
            continue
        if start < now or not str(row["location"]).strip():
            continue
        official = row["link"].replace("http://", "https://")
        records.append({"id": f"nycparks-bigapps:{row['guid']}", "title": row["title"], "date": start.date().isoformat(), "startsAt": start.isoformat(), "endsAt": end.isoformat(), "locationLabel": row["location"], "venueAddress": row["location"], "summary": row.get("description") or f"{row['title']} listed by NYC Parks.", "officialUrl": official, "expiresAt": end.isoformat(), "source": {"authorityTier": "city_government", "name": "NYC Department of Parks & Recreation", "reviewStatus": "verified", "url": FEED}})
    unique = {r["id"]: r for r in records}
    if not unique:
        raise SystemExit("No current NYC Parks BigApps records")
    payload = json.loads(INDEX.read_text(encoding="utf-8"))
    items = payload["artifacts"]["events"]["items"]
    existing = {item["id"] for item in items}
    items.extend(r for r in unique.values() if r["id"] not in existing)
    payload["generatedAt"] = "2026-09-30T00:00:00Z"
    payload["artifacts"]["events"]["generatedAt"] = payload["generatedAt"]
    INDEX.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    for retired in backlog.get("retiredCandidates", []):
        if retired["sourceId"] == "volunteer-nycgovparks-org-4b7ad625":
            retired.update({"status": "INTEGRATED_STATIC", "originalUrl": FEED, "evidence": f"Official NYC Parks BigApps upcoming-14-days JSON returned {len(unique)} current/future records with GUIDs, explicit local start/end times, locations, and canonical NYC Parks links; records published to the NYC civic package.", "nextAcquisitionPath": None})
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    row = next((r for r in audit["results"] if r["sourceId"] == "volunteer-nycgovparks-org-4b7ad625"), None)
    if row:
        row.update({"replacementUrl": FEED, "status": "INTEGRATED_STATIC", "evidence": f"Official NYC Parks BigApps upcoming-14-days JSON returned {len(unique)} current/future records with GUIDs, explicit local start/end times, locations, and canonical NYC Parks links; records published to the NYC civic package.", "nextAcquisitionPath": None})
    AUDIT.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"feed": FEED, "records": len(unique)}))

if __name__ == "__main__":
    main()
