"""Record the validated Portland Parks replacement resolution."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "expansion-queues/replacement-resolution-audit-2026-09-29.json"
payload = json.loads(path.read_text(encoding="utf-8"))
source_id = "volunteer-portland-gov-fe600e12"
result = {
    "sourceId": source_id,
    "replacementUrl": "https://www.portland.gov/parks/volunteer",
    "status": "INTEGRATED_STATIC",
    "evidence": "Official Portland Parks item pages returned three future volunteer events (Argay Park Volunteer Day, Mill Park Volunteer Day, and Pier Park Stewardship Day) with stable slug URLs, explicit 2026-10-01/02 dates, times, volunteer labels, and named park locations. Three records published to the Portland civic package.",
    "nextAcquisitionPath": None,
}
payload["results"] = [item for item in payload["results"] if item.get("sourceId") != source_id]
payload["results"].append(result)
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
