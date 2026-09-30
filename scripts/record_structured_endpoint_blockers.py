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
    {
        "sourceId": "events-events-portlandonline-us-09e0b6eb",
        "replacementUrl": "https://events.portlandonline.us/",
        "status": "BLOCKED_ACCESS_OR_PERMISSION",
        "evidence": "The municipal PortlandOnline events root and calendar path both returned HTTP 403 through normal public requests. No bypass, credential use, or third-party mirror was attempted; no records were published.",
        "nextAcquisitionPath": "Obtain a City of Portland-approved public calendar export/API or a normally reachable official item-level event page with stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "events-dpr-dc-gov-67b39fe7",
        "replacementUrl": "https://calendar.dc.gov/node/all/events",
        "status": "BLOCKED_FRESHNESS",
        "evidence": "The official DC public calendar endpoint returned RSS with stable event URLs, explicit dates/times, and locations, but the sampled current feed item was dated 2013-04-17 and therefore fails the freshness requirement. No historical records were published.",
        "nextAcquisitionPath": "Recheck the official DC calendar RSS when current/future items are present, or obtain a current DPR event export/API with stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "events-chicago-gov-44124097",
        "replacementUrl": "https://www.chicago.gov/city/en/rss.html",
        "status": "BLOCKED_ENDPOINT_NOT_FOUND",
        "evidence": "The recorded official Chicago RSS entrypoint returned HTTP 404 through a normal public request. No replacement press-room content, search snippet, or undated page was treated as an event feed.",
        "nextAcquisitionPath": "Obtain a current official Chicago events RSS/ICS/JSON endpoint or source-specific dated event calendar with stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "events-sedonaaz-gov-605e78d8",
        "replacementUrl": "https://www.sedonaaz.gov/your-government/general-information/city-calendar",
        "status": "BLOCKED_ACCESS_OR_PERMISSION",
        "evidence": "The official Sedona city-calendar path returned HTTP 403 through a normal public request. No access-control bypass, alternate credential, or third-party mirror was used; no event records were published.",
        "nextAcquisitionPath": "Obtain a City of Sedona-approved public calendar export/API or a normally reachable official item-level event page with stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "volunteer-sedonaaz-gov-79ca6cb2",
        "replacementUrl": "https://www.sedonaaz.gov/your-government/departments-and-programs/parks-recreation/calendar",
        "status": "BLOCKED_ACCESS_OR_PERMISSION",
        "evidence": "The official Sedona Parks & Recreation calendar path returned HTTP 403 through a normal public request. No access-control bypass, alternate credential, or third-party mirror was used; no volunteer records were published.",
        "nextAcquisitionPath": "Obtain a City of Sedona-approved Parks & Recreation volunteer export/API or a normally reachable official item-level opportunity page with stable IDs, explicit dates/times/locations, and freshness.",
    },
    {
        "sourceId": "events-denvergov-org-c69e47eb",
        "replacementUrl": "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Public-Event-Film-Permitting/Public-Events-Calendar",
        "status": "ENDPOINT_DISCOVERED_SCHEMA_PENDING",
        "evidence": "The official Denver calendar page returned HTTP 200 and exposes the Eproval public calendar key 9ce8805d-e5be-4d77-b848-5abdb86c16bc plus the vendor calendar client. The public RPC host/client handshake was not independently replayed with a validated item payload, so no records were published from the key or page shell.",
        "nextAcquisitionPath": "Replay the Eproval public-calendar client handshake for the recorded calendar key, capture Calendar_GetPublicCalendarEntries results, and validate stable IDs, explicit dates/times/locations, official detail URLs, and freshness before promotion.",
    },
]
ids = {item["sourceId"] for item in new}
payload["results"] = [item for item in payload["results"] if item.get("sourceId") not in ids]
payload["results"].extend(new)
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
