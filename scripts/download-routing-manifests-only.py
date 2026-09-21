from pathlib import Path
import os
from huggingface_hub import snapshot_download

for line in Path('.env').read_text(encoding='utf-8').splitlines():
    if line.startswith('HF_TOKEN='):
        os.environ['HF_TOKEN'] = line.split('=', 1)[1].strip()

snapshot_download(
    repo_id='sethryst/osm-us-2026-09-07',
    repo_type='dataset',
    revision='0c15b4fed1507c7f18a2680fcebdc8a038ccd9ab',
    allow_patterns='osm-us-2026-09-07/cells/**/manifest.json',
    local_dir='.tmp-cache/manifests-only',
    max_workers=2,
)
print('manifest-only snapshot complete', flush=True)
