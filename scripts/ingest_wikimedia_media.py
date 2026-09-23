"""Discover Commons historical media without requiring live responses in tests.

Metadata is always persisted first. Media mirroring requires --mirror-media.
Hugging Face upload is opt-in via --upload-hf and HF_DATASET_REPO/HF_TOKEN.
"""
from __future__ import annotations

import argparse, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.historical_media import app_index, validate_media_bytes, write_jsonl, write_repository_layout, commons_item

API = "https://commons.wikimedia.org/w/api.php"

def fetch_json(params: dict[str, str], cache: Path) -> dict:
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists(): return json.loads(cache.read_text(encoding="utf-8"))
    url = f"{API}?{urlencode(params)}"
    with urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/1.0 historical-media"}), timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    cache.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    return payload

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--out", type=Path, default=Path("hf_historical_media"))
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--mirror-media", action="store_true")
    parser.add_argument("--approve-valid", action="store_true")
    parser.add_argument("--upload-hf", action="store_true")
    args = parser.parse_args()
    retrieved = datetime.now(timezone.utc).isoformat()
    write_repository_layout(args.out)
    search = fetch_json({"action":"query","list":"search","srsearch":args.query,"srnamespace":"6","srlimit":str(args.limit),"format":"json"}, args.out / ".cache" / "search.json")
    titles = [row["title"] for row in search.get("query", {}).get("search", [])]
    pages = fetch_json({"action":"query","titles":"|".join(titles),"prop":"imageinfo|coordinates","iiprop":"url|thumburl|mime|extmetadata","iiurlwidth":"1600","format":"json"}, args.out / ".cache" / "pages-v4.json")
    records = [commons_item(page, retrieved) for page in pages.get("query", {}).get("pages", {}).values() if page.get("imageinfo")]
    write_jsonl(args.out / "records/candidates.jsonl", records)
    write_jsonl(args.out / "rights/evidence.jsonl", [{"id": r["id"], "license_templates": r["license_templates"], "source_snapshot": r["source_snapshot"]} for r in records])
    write_jsonl(args.out / "locations/geocoded.jsonl", [{"id": r["id"], "location": r["location"]} for r in records])
    print(json.dumps({"discovered": len(records), "candidates": sum(not r["validation_errors"] for r in records), "out": str(args.out)}))
    if not args.mirror_media: return 0
    import requests
    for record in records:
        if record["validation_errors"]: continue
        response = requests.get(record["file_url"], headers={"User-Agent": "Gremlin-Lab/1.0 (historical-media; contact repository maintainers)", "Referer": record["page_url"]}, timeout=60)
        response.raise_for_status()
        evidence = validate_media_bytes(record, response.content, response.headers.get("Content-Type"))
        record["media_evidence"] = evidence
        destination = args.out / "media" / {"image":"images","audio":"audio","video":"video"}[record["media_type"]] / f"{evidence['sha256']}{Path(record['file_url']).suffix.lower()}"
        destination.write_bytes(response.content)
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
            HfApi(token=token).upload_folder(repo_id=repo_id, repo_type="dataset", folder_path=str(args.out), path_in_repo="", commit_message=f"historical media release {version}")
    return 0

if __name__ == "__main__": sys.exit(main())
