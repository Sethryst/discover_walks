"""Upload a validated national routing batch to the existing HF dataset."""
from __future__ import annotations

import argparse
from pathlib import Path
from huggingface_hub import HfApi


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", default="sethryst/osm-us-nova-dc-pilot-2026-10-04")
    parser.add_argument("--cells", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--repo-prefix", default="national-92")
    args = parser.parse_args()
    api = HfApi()
    api.upload_folder(folder_path=str(args.cells), path_in_repo=f"{args.repo_prefix}/cells", repo_id=args.repo_id, repo_type="dataset", commit_message="Publish optimized 92-cell national routing batch")
    api.upload_file(path_or_fileobj=str(args.registry), path_in_repo=f"{args.repo_prefix}/cells.json", repo_id=args.repo_id, repo_type="dataset", commit_message="Publish 92-cell national routing registry")
    api.upload_file(path_or_fileobj=str(args.source_manifest), path_in_repo=f"{args.repo_prefix}/source-manifest.json", repo_id=args.repo_id, repo_type="dataset", commit_message="Publish 92-cell national routing source manifest")
    print(f"uploaded {args.cells} and {args.registry} to {args.repo_id}/{args.repo_prefix}")


if __name__ == "__main__":
    main()
