import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "events-chicago-gov-83a3ca20"
payload["results"] = [row for row in payload["results"] if row.get("sourceId") != source_id]
payload["results"].append({"sourceId": source_id, "replacementUrl": "https://www.chicago.gov/city/en/depts/dca/supp_info/events2.html", "status": "INTEGRATED_STATIC", "evidence": "The official City of Chicago DCASE calendar JSON endpoint returned future non-recurring records with explicit start/end times, addresses, stable numeric IDs, and chicago.gov detail URLs; third-party registration URLs were excluded.", "nextAcquisitionPath": None})
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
