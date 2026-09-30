"""Record the latest bounded JSON-LD checks for date-only event listings."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
BACKLOG = ROOT / "expansion-queues/regional-source-backlog.json"
UPDATES = {
    "events-neworleans-com-0da88206": {
        "url": "https://www.neworleans.com/events/",
        "evidence": "The official New Orleans & Company event list exposes current schema.org item records with stable detail URLs, future dates, and venue labels, but the sampled JSON-LD provides date-only startDate/endDate values and no explicit start time. No event was published without a verifiable time.",
        "next": "Use official item-level detail pages or a documented calendar endpoint that exposes explicit start/end date-times, stable IDs, locations, canonical URLs, and freshness."
    },
    "events-visitrichmondva-com-1ae28ba3": {
        "url": "https://www.visitrichmondva.com/events/",
        "evidence": "The official Richmond Region Tourism event list exposes schema.org item records with stable detail URLs and venue names, but the sampled JSON-LD provides date-only startDate/endDate values; prose time ranges are not sufficient structured time evidence. No event was published without explicit start/end date-times.",
        "next": "Locate an official Richmond calendar/API field or item-level pages with explicit start/end date-times, then validate freshness, stable IDs, locations, and canonical URLs before promotion."
    }
}

audit = json.loads(AUDIT.read_text(encoding="utf-8"))
for row in audit["results"]:
    if row["sourceId"] in UPDATES:
        u = UPDATES[row["sourceId"]]
        row["replacementUrl"] = u["url"]
        row["status"] = "BLOCKED_SCHEMA"
        row["evidence"] = u["evidence"]
        row["nextAcquisitionPath"] = u["next"]
AUDIT.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
for region in backlog["regions"]:
    for item in region["queue"]:
        if item["id"] in UPDATES:
            u = UPDATES[item["id"]]
            item["resolutionDisposition"] = "BLOCKED_SCHEMA"
            item["resolutionNote"] = u["evidence"]
            item["nextAcquisitionPath"] = u["next"]
BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
