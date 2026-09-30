"""Record normal-access endpoint blockers discovered during source resolution."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
new = [
    {
        "sourceId": "events-bouldercoloradousa-com-8fb18e01",
        "replacementUrl": "https://www.bouldercoloradousa.com/includes/rest_v2/plugins_events_events_by_date/find/",
        "status": "BLOCKED_ACCESS_OR_PERMISSION",
        "evidence": "The official Boulder calendar page documents this site-owned REST path in its JavaScript, but a normal unauthenticated request returned HTTP 403. No bypass, alternate access-control path, or records from the blocked endpoint were used.",
        "nextAcquisitionPath": "Obtain an owner-approved public export/API or a normally reachable official item-level event page; require stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "events-santafe-org-8f1eb055",
        "replacementUrl": "https://www.santafe.org/visiting-santa-fe/calendar/",
        "status": "BLOCKED_CURRENT_ITEMS",
        "evidence": "The official Tourism Santa Fe calendar page returned HTTP 200, but its ItemList contained zero event items; the site-owned REST endpoint returned HTTP 403. No event was promoted from the empty list or blocked endpoint.",
        "nextAcquisitionPath": "Recheck the official calendar when current item-level listings are present, or obtain an owner-approved public export/API with stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "events-boisestatepublicradio-org-1b57dd9c",
        "replacementUrl": "https://www.boisestatepublicradio.org/community-calendar-search",
        "status": "BLOCKED_FRESHNESS",
        "evidence": "The official Boise State Public Radio community calendar returned item-level event URLs with stable slugs and explicit event pages, but the current sampled listings were dated 2026-09-29 or earlier at the 2026-09-30 freshness point. No future item was published.",
        "nextAcquisitionPath": "Recheck the official community calendar for a future dated item with explicit start/end times, location, canonical URL, and stable slug before promotion.",
    },
]
ids = {item["sourceId"] for item in new}
payload["results"] = [item for item in payload["results"] if item.get("sourceId") not in ids]
payload["results"].extend(new)
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
