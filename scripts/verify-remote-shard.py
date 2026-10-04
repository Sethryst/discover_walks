import hashlib, json, urllib.request
cid = 'z11-584-783-q9'
root = '.tmp-cache/adaptive-subpackages-v3/' + cid
manifest = json.load(open(root + '/manifest.json'))
for name, item in manifest['artifacts'].items():
    if name == 'runtime-graph.json': continue
    url = f'https://huggingface.co/datasets/sethryst/osm-us-nova-dc-pilot-2026-10-04/resolve/main/cells/{cid}/{name}?verify=v3'
    data = urllib.request.urlopen(url).read()
    print(name, len(data), item['bytes'], hashlib.sha256(data).hexdigest() == item['sha256'])
