import json, shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
plan = json.loads((root/'.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json').read_text())
all_cells = {c['id']: c for c in plan['cells']}
ids = [f'z10-{x}-{y}' for x in range(291, 296) for y in range(391, 399)]
for cid in ids:
    if cid not in all_cells:
        _, x, y = cid.split('-'); ref = all_cells[f'z10-293-{y}']; w,s,e,n = ref['bounds']; shift=(int(x)-293)*(e-w)
        all_cells[cid] = {'id':cid, 'bounds':[w+shift,s,e+shift,n], 'clipBounds':[w+shift,s,e+shift,n], 'output':f'cells/{cid}', 'sourcePbf':['state-pbf/md.pedestrian.osm.pbf']}
    c=all_cells[cid]
    if int(cid.split('-')[1]) >= 294: c['sourcePbf']=['state-pbf/pa.pedestrian.osm.pbf','state-pbf/nj.pedestrian.osm.pbf','state-pbf/de.pedestrian.osm.pbf']
    else: c['sourcePbf']=['state-pbf/dc.pedestrian.osm.pbf','state-pbf/md.pedestrian.osm.pbf','state-pbf/va.pedestrian.osm.pbf']
out=root/'.tmp-cache/fairfax-dc-build'; (out/'state-pbf').mkdir(parents=True,exist_ok=True)
for name in ['dc','md','va','pa','nj','de']:
    src = root/f'.gremlin-osm/national-pedestrian-routing/state-pbf/{name}.pedestrian.osm.pbf'
    if not src.is_file(): src = root/f'.hf-routing/osm-us-2026-09-07/state-pbf/{name}.pedestrian.osm.pbf'
    shutil.copy2(src, out/f'state-pbf/{name}.pedestrian.osm.pbf')
plan['cells']=[all_cells[i] for i in ids]; plan['release']='osm-us-2026-09-07'; (out/'walking-cell-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
print(out/'walking-cell-plan.json')
