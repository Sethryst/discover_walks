import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "volunteer-boisewatershed-org-b6e8d60b"
payload["results"] = [row for row in payload["results"] if row.get("sourceId") != source_id]
payload["results"].append({"sourceId": source_id, "replacementUrl": "https://www.boisewatershed.org/about/volunteer/", "status": "INTEGRATED_STATIC", "evidence": "The official Boise WaterShed page embedded calendar item 3161 with explicit October 14, 2026 date/time, Charlie’s Produce location, volunteer activity, and registration requirement; one record was published to the Boise volunteer package.", "nextAcquisitionPath": None})
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
