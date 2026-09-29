"""Run bounded source discovery in reproducible batches; never publish records."""
from __future__ import annotations
import argparse, json, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from gremlin_acquisition.source_discovery import discover_html

def fetch(row):
    try:
        with urlopen(Request(row["url"], headers={"User-Agent": "Gremlin-Lab/source-discovery/1.0", "Accept": "text/html,application/json,application/rss+xml,text/calendar"}), timeout=20) as response:
            body = response.read(2_000_000).decode("utf-8", "replace")
            result = discover_html(row["id"], row["url"], body, http_status=response.status, content_type=response.headers.get("content-type"), final_url=response.geturl())
            return result.jsonable()
    except Exception as exc:
        return {"source_id": row["id"], "url": row["url"], "status": "FAILED", "http_status": None, "content_type": None, "final_url": None, "jsonld_events": 0, "candidate_endpoints": [], "selector_candidates": [], "schema_status": "not-run", "schema_evidence": [type(exc).__name__, str(exc)], "blocker": "fetch-failed"}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--batch", type=int, default=25); parser.add_argument("--offset", type=int, default=0); parser.add_argument("--output", type=Path, default=ROOT / "expansion-queues" / "source-discovery-batch.json")
    args = parser.parse_args(); backlog = json.loads((ROOT / "expansion-queues" / "regional-source-backlog.json").read_text(encoding="utf-8"))
    rows = [dict(item, regionId=region["id"]) for region in backlog["regions"] for item in region["queue"] if item.get("trackingState") != "INTEGRATED_STATIC"]
    batch = rows[args.offset:args.offset + args.batch]
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(batch)))) as pool:
        results = [future.result() for future in as_completed([pool.submit(fetch, row) for row in batch])]
    results.sort(key=lambda row: row["source_id"])
    payload = {"schemaVersion": 1, "kind": "source-discovery-batch", "offset": args.offset, "batchSize": len(batch), "totalUnresolved": len(rows), "records": results}
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8"); print(json.dumps({"offset": args.offset, "batchSize": len(batch), "totalUnresolved": len(rows), "failed": sum(r["status"] == "FAILED" for r in results)}))
if __name__ == "__main__": main()
