import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "events-boisestatepublicradio-org-1b57dd9c"
payload["results"] = [row for row in payload["results"] if row.get("sourceId") != source_id]
payload["results"].append({"sourceId": source_id, "replacementUrl": "https://www.boisestatepublicradio.org/community-calendar-search", "status": "INTEGRATED_STATIC", "evidence": "The official Boise State Public Radio detail page exposed a non-recurring October 1, 2026 opening reception with explicit 5–9 PM time, Idaho Art Gallery street address, stable detail slug, and official station URL; one record was published.", "nextAcquisitionPath": None})
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
