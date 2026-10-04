"""Replace the oversized HF parent with uploaded adaptive z11 runtime shards."""
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
REPO = 'https://huggingface.co/datasets/sethryst/osm-us-nova-dc-pilot-2026-10-04/resolve/main'
LOCAL_PACKAGES = ROOT / (Path(__import__('os').environ.get('ADAPTIVE_PACKAGE_ROOT', '.tmp-cache/adaptive-subpackages-v2')))
IDS = sorted(p.name for p in LOCAL_PACKAGES.iterdir() if p.is_dir() and p.name.startswith('z11-'))
ASSET_VERSION = 'adaptive-binary-5'

def adjacent(a, b):
    vertical = (abs(a[2]-b[0]) < 1e-7 or abs(b[2]-a[0]) < 1e-7) and min(a[3],b[3]) > max(a[1],b[1])
    horizontal = (abs(a[3]-b[1]) < 1e-7 or abs(b[3]-a[1]) < 1e-7) and min(a[2],b[2]) > max(a[0],b[0])
    return vertical or horizontal

registry = json.load(urlopen(f'{REPO}/cells.json'))
prior = {c['id']: c for c in registry['cells']}
stale_adaptive = [c['id'] for c in registry['cells'] if c['id'].startswith('z11-') and '-q' in c['id']]
replaced_parents = ['z10-292-391', 'z11-584-782', 'z11-584-783', 'z11-585-782', 'z11-585-783']
registry['cells'] = [c for c in registry['cells'] if c['id'] not in (replaced_parents + stale_adaptive)]
for cid in IDS:
    local_manifest = LOCAL_PACKAGES / cid / 'manifest.json'
    remote_manifest = json.load(urlopen(f'{REPO}/cells/{cid}/manifest.json')) if not local_manifest.is_file() else None
    manifest = json.loads(local_manifest.read_text()) if local_manifest.is_file() else remote_manifest
    shard = LOCAL_PACKAGES / cid / 'shard.json'
    shard_meta = json.loads(shard.read_text()) if shard.is_file() else {}
    if 'bounds' not in manifest:
        manifest['bounds'] = shard_meta.get('bounds') or prior.get(cid, {}).get('bounds')
    if 'sourceRelease' not in manifest:
        manifest['sourceRelease'] = prior.get(cid, {}).get('sourceRelease') or (remote_manifest or {}).get('sourceRelease') or 'osm-us-2026-09-07'
    artifacts = {'manifest': {'url': f'{REPO}/cells/{cid}/manifest.json?v={ASSET_VERSION}', 'bytes': local_manifest.stat().st_size if local_manifest.is_file() else 853, 'sha256': manifest.get('manifestSha256')}, 'map': {'url': f'{REPO}/map/pilot.pmtiles', 'mode': 'pmtiles_range'}}
    if local_manifest.is_file():
        for name, item in manifest['artifacts'].items():
            artifacts[name] = {'url': f'{REPO}/cells/{cid}/{name}?v={ASSET_VERSION}', 'bytes': item['bytes'], 'sha256': item['sha256']}
    else:
        artifacts['graph'] = {'url': f'{REPO}/cells/{cid}/runtime-graph.json', 'bytes': manifest['graphBytes'], 'sha256': manifest['graphSha256'], 'graphVersion': manifest['graphVersion']}
    registry['cells'].append({'id': cid, 'cellId': cid, 'bounds': manifest['bounds'], 'availability': 'routing_available', 'sourceRelease': manifest['sourceRelease'], 'routingNeighbors': [], 'stitching': {'coordinateConvention':'[lon,lat]','sharedBoundaryRouting':'neighbor_cell_handoff','snapToleranceMeters':3}, 'artifacts': artifacts})
registry['cells'].sort(key=lambda c: c['id'])
for c in registry['cells']: c['routingNeighbors'] = sorted(set(x['id'] for x in registry['cells'] if x['id'] != c['id'] and adjacent(c['bounds'], x['bounds'])))
registry['shardPolicy'] = {'strategy':'adaptive-z11-binary-runtime-packages','replacedParent':'z10-292-391','replacedParents':replaced_parents,'maxGraphBytes':max(sum(v.get('bytes', 0) for k, v in c['artifacts'].items() if k.endswith('.bin')) for c in registry['cells'] if c['id'] in IDS)}
out = ROOT / 'motherbird/data/national-routing/osm-us-nova-dc-pilot-2026-10-04/cells.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(registry, indent=2) + '\n')
print(json.dumps({'output': str(out), 'cells': len(registry['cells']), 'adaptive': IDS}))
