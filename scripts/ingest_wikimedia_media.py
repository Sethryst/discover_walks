"""Discover Commons historical media without requiring live responses in tests.

Metadata is always persisted first. Media mirroring requires --mirror-media.
Hugging Face upload is opt-in via --upload-hf and HF_DATASET_REPO/HF_TOKEN.
"""
from __future__ import annotations

import argparse, json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from app.pipeline.historical_media import app_index, validate_media_bytes, write_jsonl, write_repository_layout, commons_item

API = "https://commons.wikimedia.org/w/api.php"

def fetch_json(params: dict[str, str], cache: Path) -> dict:
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists(): return json.loads(cache.read_text(encoding="utf-8"))
    params = {**params, "maxlag": "5"}
    url = f"{API}?{urlencode(params)}"
    for attempt in range(6):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/1.0 (https://github.com/Sethryst/discover_walks) historical-media"}), timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if payload.get("error", {}).get("code") == "maxlag": raise RuntimeError(payload["error"].get("info", "maxlag"))
            break
        except Exception:
            if attempt == 5: raise
            time.sleep(min(60, 2 ** attempt))
    cache.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    return payload

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--out", type=Path, default=Path("hf_historical_media"))
    parser.add_argument("--limit", type=int, default=500, help="maximum unique Commons files to discover")
    parser.add_argument("--mirror-media", action="store_true")
    parser.add_argument("--approve-valid", action="store_true")
    parser.add_argument("--upload-hf", action="store_true")
    parser.add_argument("--upload-batch-size", type=int, default=100)
    args = parser.parse_args()
    retrieved = datetime.now(timezone.utc).isoformat()
    write_repository_layout(args.out)
    checkpoint_path = args.out / ".checkpoint.json"
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8")) if checkpoint_path.exists() else {"query": args.query, "titles": [], "media": {}}
    titles = list(dict.fromkeys(checkpoint.get("titles", [])))
    offset = checkpoint.get("search_offset", 0)
    page_no = checkpoint.get("search_page", 0)
    while len(titles) < args.limit:
        search = fetch_json({"action":"query","list":"search","srsearch":args.query,"srnamespace":"6","srlimit":"50","sroffset":str(offset),"format":"json"}, args.out / ".cache" / f"search-{page_no:04d}.json")
        page_titles = [row["title"] for row in search.get("query", {}).get("search", [])]
        titles = list(dict.fromkeys(titles + page_titles))
        continuation = search.get("continue", {}).get("sroffset")
        if not page_titles or continuation is None: break
        offset, page_no = int(continuation), page_no + 1
        checkpoint.update({"query": args.query, "titles": titles, "search_offset": offset, "search_page": page_no})
        checkpoint_path.write_text(json.dumps(checkpoint, indent=2, sort_keys=True), encoding="utf-8")
    titles = titles[:args.limit]
    pages_by_id = {}
    metadata_batch_size = 10
    for batch_no in range(0, len(titles), metadata_batch_size):
        batch_titles = titles[batch_no:batch_no + metadata_batch_size]
        pages = fetch_json({"action":"query","titles":"|".join(batch_titles),"prop":"imageinfo|coordinates","iiprop":"url|thumburl|mime|extmetadata","iiurlwidth":"1600","format":"json"}, args.out / ".cache" / f"pages-{batch_no // 50:04d}.json")
        pages_by_id.update(pages.get("query", {}).get("pages", {}))
        checkpoint.update({"metadata_batches": (batch_no // metadata_batch_size) + 1, "titles": titles})
        checkpoint_path.write_text(json.dumps(checkpoint, indent=2, sort_keys=True), encoding="utf-8")
    records = [commons_item(page, retrieved) for page in pages_by_id.values() if page.get("imageinfo")]
    write_jsonl(args.out / "records/candidates.jsonl", records)
    write_jsonl(args.out / "rights/evidence.jsonl", [{"id": r["id"], "license_templates": r["license_templates"], "source_snapshot": r["source_snapshot"]} for r in records])
    write_jsonl(args.out / "locations/geocoded.jsonl", [{"id": r["id"], "location": r["location"]} for r in records])
    print(json.dumps({"discovered": len(records), "candidates": sum(not r["validation_errors"] for r in records), "out": str(args.out)}))
    if not args.mirror_media: return 0
    import requests
    for record in records:
        if record["validation_errors"]: continue
        prior = checkpoint.get("media", {}).get(record["id"])
        if prior and Path(prior.get("path", "")).exists():
            record["media_evidence"] = {k: prior[k] for k in ("sha256", "bytes", "mime_type") if k in prior}
            continue
        for attempt in range(6):
            response = requests.get(record["file_url"], headers={"User-Agent": "Gremlin-Lab/1.0 (https://github.com/Sethryst/discover_walks) historical-media", "Referer": record["page_url"]}, timeout=60)
            if response.status_code not in (429, 503): break
            if attempt == 5: response.raise_for_status()
            delay = int(response.headers.get("Retry-After", min(60, 2 ** attempt)))
            time.sleep(min(300, delay))
        response.raise_for_status()
        evidence = validate_media_bytes(record, response.content, response.headers.get("Content-Type"))
        record["media_evidence"] = evidence
        destination = args.out / "media" / {"image":"images","audio":"audio","video":"video"}[record["media_type"]] / f"{evidence['sha256']}{Path(record['file_url']).suffix.lower()}"
        destination.write_bytes(response.content)
        checkpoint.setdefault("media", {})[record["id"]] = {"path": str(destination), **evidence}
        checkpoint_path.write_text(json.dumps(checkpoint, indent=2, sort_keys=True), encoding="utf-8")
    write_jsonl(args.out / "records/candidates.jsonl", records)
    if args.approve_valid:
        approved = [r | {"state": "approved", "decision_history": [{"state": "approved", "reason": "rights, location, and media validation passed", "at": retrieved}]} for r in records if not r["validation_errors"] and r.get("media_evidence")]
        write_jsonl(args.out / "records/approved.jsonl", approved)
        version = retrieved[:10].replace("-", "")
        release = args.out / "releases" / version
        release.mkdir(parents=True, exist_ok=True)
        index = app_index(approved, version)
        (release / "app-index.json").write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"approved": len(approved), "release": str(release / 'app-index.json')}))
        if args.upload_hf:
            repo_id = os.environ.get("HF_DATASET_REPO")
            token = os.environ.get("HF_TOKEN")
            if not repo_id or not token: raise RuntimeError("--upload-hf requires HF_DATASET_REPO and HF_TOKEN")
            try:
                from huggingface_hub import HfApi
            except ImportError as exc: raise RuntimeError("install huggingface_hub to upload") from exc
            api = HfApi(token=token)
            files = sorted(p for p in args.out.rglob("*") if p.is_file() and ".cache" not in p.parts)
            for start in range(0, len(files), args.upload_batch_size):
                batch = files[start:start + args.upload_batch_size]
                patterns = [p.relative_to(args.out).as_posix() for p in batch]
                api.upload_folder(repo_id=repo_id, repo_type="dataset", folder_path=str(args.out), path_in_repo="", allow_patterns=patterns, ignore_patterns=[".cache/**"], commit_message=f"historical media release {version} batch {start // args.upload_batch_size + 1}")
                checkpoint.setdefault("hf_upload_batches", []).append({"batch": start // args.upload_batch_size + 1, "files": patterns, "uploaded_at": datetime.now(timezone.utc).isoformat()})
                checkpoint_path.write_text(json.dumps(checkpoint, indent=2, sort_keys=True), encoding="utf-8")
    return 0

if __name__ == "__main__": sys.exit(main())
