import json
from pathlib import Path

p = Path('published/national-routing/osm-us-2026-09-07/cells.json')
d = json.loads(p.read_text())
for c in d['cells']:
    if c['cellId'] == 'z10-291-392':
        url = 'https://huggingface.co/datasets/sethryst/motherbird-routing-test-z10-291-392/resolve/main/cells/z10-291-392/runtime-graph.json'
        c['byteCount'] = 305307365
        c['graphHash'] = '774d6f58d4f27c59544cbba2ee426468fd81cb96d815abc236618c90f5783785'
        c['graphPath'] = 'cells/z10-291-392/runtime-graph.json'
        c['compileStatus'] = 'complete'
        c['availability'] = 'routing_available'
        c['artifacts']['graph'].update(bytes=305307365, sha256=c['graphHash'], url=url, graphVersion='motherbird-runtime-graph-v1')
        break
p.write_text(json.dumps(d, indent=2, sort_keys=True) + '\n')
print('patched Fairfax')
