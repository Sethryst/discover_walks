import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "events-downtownnorfolk-org-cf7e9296"
payload["results"] = [row for row in payload["results"] if row.get("sourceId") != source_id]
payload["results"].append({"sourceId": source_id, "replacementUrl": "https://www.downtownnorfolk.org/explore/calendar", "status": "INTEGRATED_STATIC", "evidence": "Official Downtown Norfolk detail pages exposed explicit date, time, location, and canonical URL fields for three current/future events; three records were published to Norfolk civic events.", "nextAcquisitionPath": None})
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
