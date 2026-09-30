"""Record schema and freshness outcomes for the user-authorized public feeds."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
AUDIT = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
OUTCOMES = {
    "volunteer-nycgovparks-org-4b7ad625": ("BLOCKED_FRESHNESS", "https://data.cityofnewyork.us/resource/fudw-fgrp.json", "Official NYC Parks Socrata metadata exposes event_id, title, date, start_time, end_time, location_description, url, and the joinable cpcm-i88g location dataset. The current/future query returned no rows and sampled inventory records are historical, so no current volunteer/event records were published.", "Recheck the official Socrata inventory for current/future rows and join cpcm-i88g locations before publication."),
    "events-chicago-gov-44124097": ("BLOCKED_FRESHNESS", "https://data.chicago.gov/resource/xgse-8eg7.json", "The official Chicago Special Events Calendar is a public Socrata view backed by xgse-8eg7 with explicit date, start_time, venue, venue_address, event_details, and coordinates. The current public rows sampled were dated 2025, so they fail the 2026 freshness requirement and were not published.", "Recheck xgse-8eg7 for current/future rows and preserve the official dataset URL and field provenance."),
    "meetings-dcouncil-us-4d64fb67": ("ENDPOINT_DISCOVERED_NO_CURRENT_ITEMS", "https://dccouncil.gov/events/feed/", "The official DC Council RSS directory resolves to a public Calendar RSS feed with valid RSS schema and a current lastBuildDate, but the feed contains no current event items. No meeting was fabricated from an empty feed.", "Recheck the official Calendar RSS when current dated meeting items are present; require stable links, explicit dates/times, locations, and freshness."),
    "events-dpr-dc-gov-67b39fe7": ("BLOCKED_FRESHNESS", "https://dc.gov/node/feed/events", "The official DC Government RSS directory resolves to the public Events feed, which currently contains a valid empty RSS channel. The legacy calendar RSS contains 2013 items and fails freshness; no historical records were published.", "Recheck the official DC Events feed when current items appear, requiring stable links, explicit dates/times, locations, and freshness."),
}

backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
for row in backlog.get("retiredCandidates", []):
    if row["sourceId"] in OUTCOMES:
        status, url, evidence, next_path = OUTCOMES[row["sourceId"]]
        row.update({"status": status, "originalUrl": url, "evidence": evidence, "nextAcquisitionPath": next_path})
BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

audit = json.loads(AUDIT.read_text(encoding="utf-8"))
for row in audit["results"]:
    if row["sourceId"] in OUTCOMES:
        status, url, evidence, next_path = OUTCOMES[row["sourceId"]]
        row.update({"status": status, "replacementUrl": url, "evidence": evidence, "nextAcquisitionPath": next_path})
AUDIT.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
