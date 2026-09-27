"""Resumable bounded-concurrency Fairfax/DC cell build queue."""
from __future__ import annotations
import argparse, json, os, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

CELLS = [f"z10-{x}-{y}" for x in range(291, 296) for y in range(391, 399)]
BINARIES = ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")

def run_one(cid: str, args) -> dict:
    cell = args.work / "cells" / cid
    manifest = cell / "manifest.json"
    if manifest.exists() and all((cell / name).is_file() for name in BINARIES):
        try:
            existing = json.loads(manifest.read_text())
            if existing.get("node_count", existing.get("nodeCount", 0)) > 0 and existing.get("edge_count", existing.get("edgeCount", 0)) > 0:
                return {"cell": cid, "status": "packaged", "skipped": True}
        except (OSError, ValueError):
            pass
    log = args.logs / f"{cid}.log"
    cmd = [sys.executable, "-m", "app.pipeline.walking_cell_graphs", "--plan", str(args.work / "walking-cell-plan.json"), "--work-dir", str(args.work), "--osmium", args.osmium, "--cell-id", cid]
    env = os.environ.copy()
    # Large corridor cells materialize millions of graph records. Keep the
    # queue's child processes on the same heap budget used by the validated
    # targeted conversion instead of silently falling back to Node's 4 GB cap.
    node_options = env.get("NODE_OPTIONS", "").strip()
    if "--max-old-space-size=" not in node_options:
        node_options = f"{node_options} --max-old-space-size=12288".strip()
    env["NODE_OPTIONS"] = node_options
    for attempt in range(1, args.retries + 1):
        with log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"event":"start","cell":cid,"attempt":attempt}) + "\n")
            result = subprocess.run(cmd, cwd=args.root, env=env, stdout=stream, stderr=subprocess.STDOUT, text=True)
            if result.returncode == 0 and (cell / "runtime-graph.json").is_file() and manifest.is_file():
                package = ["node", "--input-type=module", "-e", "import fs from 'node:fs/promises'; import {writeRuntimePackage} from './motherbird/tools/pedestrian-network/runtime-package.mjs'; const d=process.argv[1]; const r=JSON.parse(await fs.readFile(d+'/runtime-graph.json','utf8')); await writeRuntimePackage(d,r);", str(cell)]
                packaged = subprocess.run(package, cwd=args.root, env=env, stdout=stream, stderr=subprocess.STDOUT).returncode == 0
                if packaged and all((cell / name).is_file() for name in BINARIES):
                    return {"cell": cid, "status": "packaged", "attempt": attempt}
        with log.open("a", encoding="utf-8") as stream: stream.write(json.dumps({"event":"retry","cell":cid,"attempt":attempt,"returncode":result.returncode}) + "\n")
    return {"cell": cid, "status": "failed", "log": str(log)}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--work",type=Path,required=True); ap.add_argument("--max-workers",type=int,default=2); ap.add_argument("--retries",type=int,default=2); ap.add_argument("--osmium",default="osmium"); ap.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[1]); ap.add_argument("--cell-id",action="append",dest="cell_ids",help="restrict the run to one or more cells"); args=ap.parse_args(); args.logs=args.work/"queue-logs"; args.logs.mkdir(parents=True,exist_ok=True)
    def valid(c):
        m=args.work/"cells"/c/"manifest.json"
        if not (m.is_file() and all((args.work/"cells"/c/n).is_file() for n in BINARIES)): return False
        try:
            j=json.loads(m.read_text()); return j.get("node_count",j.get("nodeCount",0)) > 0 and j.get("edge_count",j.get("edgeCount",0)) > 0
        except (OSError,ValueError): return False
    selected = set(args.cell_ids or CELLS)
    targets=[c for c in CELLS if c in selected and not valid(c)]
    with ThreadPoolExecutor(max_workers=max(1,args.max_workers)) as pool:
        futures=[pool.submit(run_one,c,args) for c in targets]
        results=[f.result() for f in as_completed(futures)]
    print(json.dumps({"queued":len(targets),"results":sorted(results,key=lambda x:x["cell"])}))
if __name__ == "__main__": main()
