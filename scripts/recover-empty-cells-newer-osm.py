from pathlib import Path
import json, shutil, subprocess, sys, urllib.request

ROOT = Path(__file__).resolve().parents[1]
plan_path = ROOT / '.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json'
plan = json.loads(plan_path.read_text())
registry = ROOT / 'published/national-routing/osm-us-2026-09-07/cells.json'
ids = sorted(c['cellId'] for c in json.loads(registry.read_text())['cells'] if c.get('availability') == 'routing_unavailable')
work = ROOT / '.tmp-cache/recompile-newer-work/osm-us-2026-09-21'
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
