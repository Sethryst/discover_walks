from pathlib import Path
import json, os, shutil, subprocess, sys
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[1]
plan_path = ROOT / '.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json'
plan = json.loads(plan_path.read_text())
manifests = ROOT / '.tmp-cache/manifests-only/osm-us-2026-09-07/cells'
ids = []
for f in manifests.glob('*/manifest.json'):
    d = json.loads(f.read_text())
    if int(d.get('nodeCount', 0) or 0) == 0 or int(d.get('edgeCount', 0) or 0) == 0:
        ids.append(f.parent.name)
ids.sort()
work = ROOT / '.tmp-cache/recompile-work/osm-us-2026-09-07'
work.mkdir(parents=True, exist_ok=True)
shards = snapshot_download(
    repo_id='sethryst/osm-us-2026-09-07', repo_type='dataset',
    revision='0c15b4fed1507c7f18a2680fcebdc8a038ccd9ab',
    allow_patterns=['osm-us-2026-09-07/state-pbf/ak.pedestrian.osm.pbf', 'osm-us-2026-09-07/state-pbf/la.pedestrian.osm.pbf'],
    local_dir=ROOT / '.tmp-cache/target-shards', max_workers=1)
source_root = ROOT / '.tmp-cache/target-shards/osm-us-2026-09-07'
(work / 'walking-cell-plan.json').write_text(plan_path.read_text())
(work / 'state-pbf').mkdir(exist_ok=True)
for state in ('ak', 'la'):
    shutil.copy2(source_root / 'state-pbf' / f'{state}.pedestrian.osm.pbf', work / 'state-pbf' / f'{state}.pedestrian.osm.pbf')
log = ROOT / '.tmp-cache/recompile-empty-cells.log'
with log.open('a', encoding='utf-8') as stream:
    stream.write(json.dumps({'target_cells': len(ids), 'states': ['ak', 'la']}) + '\n')
    for index, cid in enumerate(ids, 1):
        result = subprocess.run([sys.executable, '-m', 'app.pipeline.walking_cell_graphs', '--plan', str(work / 'walking-cell-plan.json'), '--work-dir', str(work), '--osmium', 'osmium', '--cell-id', cid], cwd=ROOT, text=True, capture_output=True)
        stream.write(json.dumps({'index': index, 'cell': cid, 'returncode': result.returncode, 'stdout': result.stdout[-2000:], 'stderr': result.stderr[-2000:]}) + '\n')
        stream.flush()
        if result.returncode:
            raise SystemExit(result.returncode)
print(json.dumps({'completed': len(ids), 'work': str(work), 'log': str(log)}))
