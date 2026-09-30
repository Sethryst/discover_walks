import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "events-seattle-gov-cca4136c"
payload["results"] = [row for row in payload["results"] if row.get("sourceId") != source_id]
payload["results"].append({"sourceId": source_id, "replacementUrl": "https://www.seattle.gov/event-calendar", "status": "INTEGRATED_STATIC", "evidence": "Seattle.gov embeds a reachable Trumba JSON feed with future non-recurring records, explicit date/time/location fields, stable event IDs, and Seattle.gov permalinks; meeting and volunteer-work listings were excluded.", "nextAcquisitionPath": None})
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
