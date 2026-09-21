from pathlib import Path
import json, shutil, subprocess, sys, urllib.request

ROOT = Path(__file__).resolve().parents[1]
plan_path = ROOT / '.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json'
plan = json.loads(plan_path.read_text())
old = ROOT / '.tmp-cache/manifests-only/osm-us-2026-09-07/cells'
ids = sorted(json.loads(f.read_text()).get('cellId', f.parent.name) for f in old.glob('*/manifest.json') if (lambda d: int(d.get('nodeCount', 0) or 0) == 0 or int(d.get('edgeCount', 0) or 0))(json.loads(f.read_text())))
work = ROOT / '.tmp-cache/recompile-newer-work/osm-us-2026-09-07'
state = work / 'state-pbf'
state.mkdir(parents=True, exist_ok=True)
(work / 'walking-cell-plan.json').write_text(plan_path.read_text())
urls = {'ak': 'https://download.geofabrik.de/north-america/us/alaska-latest.osm.pbf', 'la': 'https://download.geofabrik.de/north-america/us/louisiana-latest.osm.pbf'}
for st, url in urls.items():
    dest = state / f'{st}.pedestrian.osm.pbf'
    if not dest.exists():
        urllib.request.urlretrieve(url, dest)
log = ROOT / '.tmp-cache/recompile-newer-empty-cells.log'
with log.open('a', encoding='utf-8') as stream:
    stream.write(json.dumps({'target_cells': len(ids), 'source': 'geofabrik-latest', 'release_note': 'not osm-us-2026-09-07'}) + '\n')
    for index, cid in enumerate(ids, 1):
        result = subprocess.run([sys.executable, '-m', 'app.pipeline.walking_cell_graphs', '--plan', str(work / 'walking-cell-plan.json'), '--work-dir', str(work), '--osmium', 'osmium', '--cell-id', cid], cwd=ROOT, text=True, capture_output=True)
        stream.write(json.dumps({'index': index, 'cell': cid, 'returncode': result.returncode, 'stdout': result.stdout[-1000:], 'stderr': result.stderr[-1000:]}) + '\n')
        stream.flush()
        if result.returncode:
            raise SystemExit(result.returncode)
print(json.dumps({'completed': len(ids), 'work': str(work), 'log': str(log)}))
