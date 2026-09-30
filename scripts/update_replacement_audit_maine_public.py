import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "events-mainepublic-org-bfb30cd0"
payload["results"] = [row for row in payload["results"] if row.get("sourceId") != source_id]
payload["results"].append({"sourceId": source_id, "replacementUrl": "https://www.mainepublic.org/community-calendar", "status": "INTEGRATED_STATIC", "evidence": "The official Maine Public detail page for the Maxwell Quartet exposed a stable URL, explicit October 25, 2026 date, 3:00–4:30 PM time, and Minsky Recital Hall venue; one record was published to Portland-Maine civic events.", "nextAcquisitionPath": None})
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
