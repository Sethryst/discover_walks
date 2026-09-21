"""Probe approved endpoints and record actionable lifecycle blockers."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json

ROOT = Path(__file__).resolve().parents[1]
queue = json.loads((ROOT / "expansion-queues/captain-approval-override-2026-09-20.json").read_text())

def probe(candidate):
    try:
        with urlopen(Request(candidate["url"], headers={"User-Agent": "Gremlin-Lab/1.0"}, method="HEAD"), timeout=8) as response:
            return {"status": response.status, "contentType": response.headers.get_content_type(), "error": None}
    except HTTPError as exc:
        return {"status": exc.code, "contentType": None, "error": f"HTTP {exc.code}"}
    except Exception as exc:
        return {"status": None, "contentType": None, "error": f"{type(exc).__name__}: {str(exc)[:120]}"}

def build(candidate):
    probe_result = probe(candidate)
    category = candidate["category"]
    blockers = ["no active app/regions source configuration", "no generated release evidence"]
    if probe_result["status"] != 200:
        blockers.append("endpoint probe did not return HTTP 200; verify redirect, bot policy, TLS, or replacement URL")
    if category in {"meetings", "volunteer", "publicSpaces"}:
        blockers.append(f"no approved adapter contract for {category}; define a source-specific adapter or verified structured feed")
    else:
        blockers.append("endpoint format, terms/license, fixture, mapping, stable ID, coordinates, refresh policy, and focused tests remain unverified")
    return {"candidateId": candidate["candidateId"], "regionId": candidate["regionId"], "url": candidate["url"], "category": category, "endpointProbe": probe_result, "status": "BLOCKED", "blockers": blockers, "nextAction": "refine endpoint and complete lifecycle gates; then add active region config and run a generated release build"}

with ThreadPoolExecutor(max_workers=12) as executor:
    records = list(executor.map(build, queue["candidates"]))
report = {"schemaVersion": 1, "kind": "candidate-blocker-investigation", "source": "expansion-queues/captain-approval-override-2026-09-20.json", "policy": "Approval authorizes research; staged acceptance is allowed, but LANDED requires active region configuration and generated release evidence.", "summary": {"candidates": len(records), "blocked": len(records), "http200": sum(r["endpointProbe"]["status"] == 200 for r in records), "non200OrUnreachable": sum(r["endpointProbe"]["status"] != 200 for r in records)}, "candidates": records}
(ROOT / "expansion-queues/captain-approval-blocker-investigation-2026-09-20.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report["summary"], sort_keys=True))
