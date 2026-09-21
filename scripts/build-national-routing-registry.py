import json, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.national_routing_manifest import build_manifest

REPO = 'sethryst/osm-us-2026-09-07'
SUBFOLDER = 'osm-us-2026-09-07/cells'
plan = json.loads(Path('.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json').read_text())
out = Path('published/national-routing/osm-us-2026-09-07/cells.json')
tree = list(HfApi().list_repo_tree(REPO, repo_type='dataset', revision='main', path_in_repo=SUBFOLDER, recursive=True))
sizes = {item.path.split('/')[-2]: item.size for item in tree if item.path.endswith('/runtime-graph.json')}
def fetch(item):
    cell_id = item['id']
    try:
        path = hf_hub_download(REPO, f'{SUBFOLDER}/{cell_id}/manifest.json', repo_type='dataset')
        return cell_id, json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return cell_id, None

with ThreadPoolExecutor(max_workers=32) as pool:
    remote = dict(pool.map(fetch, plan['cells']))
manifest = build_manifest(plan, Path('.'))
for cell in manifest['cells']:
    receipt = remote.get(cell['cellId']) or {}
    size = sizes.get(cell['cellId'])
    if receipt.get('status') == 'complete' and receipt.get('graphSha256') and size:
        cell['availability'] = 'routing_available'
        cell['compileStatus'] = receipt.get('compileStatus', 'complete')
        cell['graphHash'] = receipt['graphSha256']
        cell['artifacts']['graph']['sha256'] = receipt['graphSha256']
        cell['byteCount'] = size
        cell['artifacts']['graph']['bytes'] = size
    else:
        cell['availability'] = 'routing_unavailable'
    cell['artifacts']['map']['url'] = 'https://huggingface.co/datasets/sethryst/osm-us-2026-09-07/resolve/main/osm-us-2026-09-07/national-walk.pmtiles'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
print(json.dumps({'cells': len(manifest['cells']), 'routingAvailable': sum(c['availability'] == 'routing_available' for c in manifest['cells']), 'output': str(out)}))
