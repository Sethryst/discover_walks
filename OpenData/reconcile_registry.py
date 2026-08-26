"""Promote existing successful downloads into the updater registry."""
from __future__ import annotations
import csv, re
from pathlib import Path
from scraper import DEFAULT_DATASETS, DEFAULT_OUTPUT, DatasetRecord, load_datasets

ID = re.compile(r"_([a-z0-9]{4}-[a-z0-9]{4})\.geojson$", re.I)
FIELDS = ["State","City","Platform","Dataset_ID","Dataset_Name","Source_URL","File","Status","Last_Observed_Feature_Count","Last_Checked","Notes"]

def main() -> int:
    portals = {(r["State"].casefold(),r["City"].casefold()): r for r in csv.DictReader((DEFAULT_OUTPUT / "portals.csv").open(encoding="utf-8-sig"))}
    known = {(r.state.casefold(),r.city.casefold(),r.file.replace("\\","/")) for r in load_datasets(DEFAULT_DATASETS)}
    additions=[]
    for state_dir in DEFAULT_OUTPUT.iterdir():
        if not state_dir.is_dir() or state_dir.name in {"logs","derived","__pycache__"}: continue
        for city_dir in state_dir.iterdir():
            if not city_dir.is_dir(): continue
            portal=portals.get((state_dir.name.casefold(),city_dir.name.casefold()),{})
            for path in city_dir.glob("*.geojson"):
                rel=path.relative_to(DEFAULT_OUTPUT).as_posix()
                if (state_dir.name.casefold(),city_dir.name.casefold(),rel.casefold()) in known: continue
                match=ID.search(path.name)
                socrata=match and portal.get("Platform","").casefold()=="socrata"
                ident=match.group(1) if match else f"local-{path.stem}"
                base=portal.get("Portal_URL","").rstrip("/")
                additions.append({"State":state_dir.name,"City":city_dir.name,"Platform":"Socrata" if socrata else "Other","Dataset_ID":ident,"Dataset_Name":path.stem.replace("_"," ").title(),"Source_URL":f"{base}/resource/{ident}.geojson" if socrata else "","File":rel,"Status":"curated" if socrata else "local_only","Last_Observed_Feature_Count":"","Last_Checked":"","Notes":"Promoted from validated existing GeoJSON; do not rediscover."})
    if additions:
        with DEFAULT_DATASETS.open("a",newline="",encoding="utf-8") as handle:
            writer=csv.DictWriter(handle,fieldnames=FIELDS); writer.writerows(additions)
    print(f"promoted={len(additions)} curated={sum(x['Status']=='curated' for x in additions)} local_only={sum(x['Status']=='local_only' for x in additions)}")
    return 0
if __name__ == "__main__": raise SystemExit(main())
