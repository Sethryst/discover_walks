"""Verify the five non-HTML backlog endpoints through existing adapters."""
from __future__ import annotations
import json, sys
from pathlib import Path
from urllib.request import Request, urlopen
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from gremlin_acquisition.source_discovery import verify_structured_schema

def main():
    backlog = json.loads((ROOT / "expansion-queues/regional-source-backlog.json").read_text())
    rows = [item for region in backlog["regions"] for item in region["queue"] if item.get("trackingState") != "INTEGRATED_STATIC" and item.get("likelyDataType") != "HTML calendar"]
    results = []
    for row in rows:
        provider = {"RSS/ICS": "rss", "JSON API": "json"}.get(row["likelyDataType"], "json")
        config = {"provider": provider, "url": row["url"], "category": row["category"], "propertyMapping": {"id": "id", "name": "name"}}
        if provider == "rss": config["paginate"] = False
        def transport(url):
            with urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/schema-verification/1.0", "Accept": "application/json,application/rss+xml,text/calendar"}), timeout=20) as response: return response.read()
        result = verify_structured_schema(row["id"], config, transport)
        results.append(result.jsonable())
    payload = {"schemaVersion": 1, "kind": "structured-source-schema-verification", "candidateCount": len(rows), "results": results}
    output = ROOT / "expansion-queues" / "structured-source-schema-verification.json"; output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"candidateCount": len(rows), "valid": sum(r["schema_status"] == "schema-valid" for r in results), "invalidOrBlocked": sum(r["schema_status"] != "schema-valid" for r in results)}))
if __name__ == "__main__": main()
