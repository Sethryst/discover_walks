import json
from pathlib import Path
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
plan = json.loads((ROOT / '.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json').read_text())
manifest_root = ROOT / '.tmp-cache/manifests-only/osm-us-2026-09-07/cells'
source_repo = 'https://huggingface.co/datasets/sethryst/osm-us-2026-09-07/resolve/0c15b4fed1507c7f18a2680fcebdc8a038ccd9ab/osm-us-2026-09-07'
tree = {}
for item in HfApi().list_repo_tree('sethryst/osm-us-2026-09-07', repo_type='dataset', revision='0c15b4fed1507c7f18a2680fcebdc8a038ccd9ab', path_in_repo='osm-us-2026-09-07/cells', recursive=True):
    if item.path.endswith('/runtime-graph.json'):
        tree[item.path.split('/')[-2]] = item

cells = []
for cell in plan['cells']:
    cid = cell['id']
    receipt_path = manifest_root / cid / 'manifest.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.is_file() else {}
    graph = tree.get(cid)
    size = int(getattr(graph, 'size', 0) or 0)
    sha = receipt.get('graphSha256')
    complete = receipt.get('status') == 'complete' and bool(sha) and size > 0 and int(receipt.get('nodeCount', 0) or 0) > 0 and int(receipt.get('edgeCount', 0) or 0) > 0
    graph_url = f'{source_repo}/cells/{cid}/runtime-graph.json'
    version = receipt.get('graphVersion') or 'motherbird-runtime-graph-v1'
    entry = {
        'id': cid, 'cellId': cid, 'bounds': cell['bounds'], 'clipBounds': cell.get('clipBounds'),
        'regionId': cell.get('regionId'), 'cityId': cell.get('cityId'), 'graphPath': f'cells/{cid}/runtime-graph.json' if complete else None,
        'byteCount': size if complete else 0, 'graphHash': sha if complete else None, 'graphVersion': version,
        'sourceRelease': plan['release'], 'compileStatus': 'complete' if complete else 'missing',
        'availability': 'routing_available' if complete else 'routing_unavailable',
        'artifacts': {'map': {'url': './national-walk.pmtiles', 'mode': 'pmtiles_range'},
                      'graph': {'url': graph_url, 'bytes': size if complete else 0, 'sha256': sha if complete else None, 'graphVersion': version}},
    }
    cells.append(entry)

out = {'format': 'motherbird-walking-cell-registry-v1', 'release': plan['release'],
       'overlapPolicy': {'allowed': True, 'tieBreak': ['smallest_bounds_area', 'cell_id_ascending']},
       'coordinateConvention': {'runtimeGraph': '[lon, lat]', 'uiRoute': '[lat, lon]'}, 'cells': cells}
dest = ROOT / 'published/national-routing/osm-us-2026-09-07/cells.json'
dest.write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
print(json.dumps({'cells': len(cells), 'routingAvailable': sum(x['availability'] == 'routing_available' for x in cells), 'manifests': len(list(manifest_root.glob('*/manifest.json'))), 'output': str(dest)}))
