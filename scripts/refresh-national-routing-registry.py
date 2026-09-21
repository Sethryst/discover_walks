"""Resumable registry refresh with server-directed Hugging Face throttling."""
from __future__ import annotations
import argparse, json, os, time
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.utils import HfHubHTTPError

def reset_seconds(headers) -> float:
    value = headers.get("RateLimit-Reset") or headers.get("X-RateLimit-Reset")
    if not value: return 300.0
    try:
        number = float(value)
        # HF documents reset as seconds remaining; tolerate epoch timestamps too.
        return max(0.0, number - time.time()) if number > 10_000_000 else max(0.0, number)
    except ValueError: return 300.0

def get_json(repo_id, filename, *, revision="main", token=None, attempts=6):
    for attempt in range(attempts):
        try:
            path = hf_hub_download(repo_id=repo_id, filename=filename, revision=revision, token=token, force_download=True)
            return json.loads(Path(path).read_text(encoding="utf-8"))
        except HfHubHTTPError as error:
            response = getattr(error, "response", None)
            status = getattr(response, "status_code", None)
            if status == 429:
                delay = reset_seconds(response.headers if response else {}) + 1
                print(f"rate limited; sleeping {delay:.1f}s until server reset", flush=True); time.sleep(delay); continue
            if status is not None and 500 <= status < 600:
                time.sleep(min(300, 2 ** attempt)); continue
            raise
    raise RuntimeError(f"failed after {attempts} attempts: {repo_id}/{filename}")

def main(argv=None):
    parser = argparse.ArgumentParser(); parser.add_argument("--repo-id", required=True); parser.add_argument("--subfolder", default=""); parser.add_argument("--revision", default="main"); parser.add_argument("--token", default=os.getenv("HF_TOKEN")); parser.add_argument("--checkpoint", type=Path, required=True); parser.add_argument("--output", type=Path, required=True); parser.add_argument("--publish", type=Path, help="also atomically copy the generated registry here"); parser.add_argument("--plan", type=Path, help="cell plan used to build the browser registry")
    args = parser.parse_args(argv); checkpoint = json.loads(args.checkpoint.read_text()) if args.checkpoint.exists() else {"manifests": {}, "failed": []}
    api = HfApi(token=args.token)
    tree = api.list_repo_tree(repo_id=args.repo_id, repo_type="dataset", revision=args.revision, path_in_repo=args.subfolder, recursive=True)
    for item in tree:
        path = item.path
        if not path.endswith("/manifest.json"): continue
        cell = path.split("/")[-2]
        if cell in checkpoint["manifests"]: continue
        try: checkpoint["manifests"][cell] = get_json(args.repo_id, path, revision=args.revision, token=args.token)
        except Exception as error: checkpoint.setdefault("failed", []).append({"cell": cell, "error": str(error)})
        args.checkpoint.parent.mkdir(parents=True, exist_ok=True); tmp = args.checkpoint.with_suffix(".part"); tmp.write_text(json.dumps(checkpoint, sort_keys=True), encoding="utf-8"); os.replace(tmp, args.checkpoint)
    if args.plan:
        # Import lazily so crawler-only operation does not require the application package.
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from app.pipeline.national_routing_manifest import build_manifest
        plan = json.loads(args.plan.read_text(encoding="utf-8"))
        registry = build_manifest(plan, args.plan.parent, remote_base=None)
        by_id = checkpoint["manifests"]
        for cell in registry["cells"]:
            receipt = by_id.get(cell["cellId"], {})
            if receipt.get("status") == "complete" and receipt.get("graphSha256") and receipt.get("graphBytes"):
                cell["availability"] = "routing_available"
                cell["artifacts"]["graph"].update(bytes=int(receipt["graphBytes"]), sha256=receipt["graphSha256"], graphVersion=receipt.get("graphVersion", cell["graphVersion"]))
            else:
                cell["availability"] = "routing_unavailable"
        payload = json.dumps(registry, indent=2, sort_keys=True) + "\n"
    else:
        payload = json.dumps(checkpoint, indent=2, sort_keys=True) + "\n"
    tmp = args.output.with_suffix(args.output.suffix + ".part"); tmp.write_text(payload, encoding="utf-8"); os.replace(tmp, args.output)
    if args.publish:
        args.publish.parent.mkdir(parents=True, exist_ok=True)
        publish_tmp = args.publish.with_suffix(args.publish.suffix + ".part"); publish_tmp.write_text(payload, encoding="utf-8"); os.replace(publish_tmp, args.publish)
    manifests = checkpoint["manifests"]
    summary = {"total": len(manifests), "routable": sum(v.get("status") == "complete" for v in manifests.values()), "unavailable": sum(v.get("status") != "complete" for v in manifests.values()), "failed": len(checkpoint.get("failed", []))}
    print(json.dumps(summary, sort_keys=True)); return 0
if __name__ == "__main__": raise SystemExit(main())
