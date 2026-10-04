"""Upload the validated adaptive subshards and registry without deleting prior HF artifacts."""
import os
import sys
from pathlib import Path
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / os.environ.get('ADAPTIVE_PACKAGE_ROOT', '.tmp-cache/adaptive-subpackages-v3')
REGISTRY = ROOT / 'motherbird/data/national-routing/osm-us-nova-dc-pilot-2026-10-04/cells.json'
REPO = 'sethryst/osm-us-nova-dc-pilot-2026-10-04'
api = HfApi()
files = []
cells = sorted(p for p in SOURCE.iterdir() if p.is_dir() and p.name.startswith('z11-'))
batch = int(sys.argv[1]) if len(sys.argv) > 1 else 0
batch_size = 10
cells = cells[batch * batch_size:(batch + 1) * batch_size]
for cell in cells:
    for artifact in sorted(cell.iterdir()):
        if artifact.name in {'shard.json', 'runtime-graph.json'}:
            continue
        files.append((artifact, f'cells/{cell.name}/{artifact.name}'))
for local, remote in files:
    api.upload_file(path_or_fileobj=str(local), path_in_repo=remote, repo_id=REPO, repo_type='dataset', commit_message='Publish recursively split HF routing subshard')
if batch == 0:
    api.upload_file(path_or_fileobj=str(REGISTRY), path_in_repo='cells.json', repo_id=REPO, repo_type='dataset', commit_message='Activate recursively split HF routing registry')
print({'batch': batch, 'uploaded_files': len(files) + (1 if batch == 0 else 0), 'cells': len(cells)})
