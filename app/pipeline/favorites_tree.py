"""Build the small, app-consumed Virginia favorites hierarchy."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = "https://services.arcgis.com/p5v98VHDX9Atv3l7/ArcGIS/rest/services/VA_Jurisdictions/FeatureServer/0"


def build_tree(payload: dict, retrieved_at: str) -> dict:
    localities, towns = [], []
    for feature in payload.get("features", []):
        properties, geometry = feature.get("properties") or {}, feature.get("geometry") or {}
        kind = properties.get("JURISTYPE")
        name, full = str(properties.get("NAME") or "").strip(), str(properties.get("NAMELSAD") or "").strip()
        bbox = _bbox(geometry.get("coordinates"))
        if not name or not bbox:
            continue
        if kind in {"CO", "CI"}:
            fips = str(properties.get("STCOFIPS") or "").strip()
            if not fips:
                continue
            localities.append({"id": f"us-va-fips-{fips}", "name": name, "name_full": full or name, "kind": "county" if kind == "CO" else "city", "bbox": bbox})
        elif kind == "TO":
            gnis, parent = str(properties.get("GNIS") or "").strip(), str(properties.get("PARENT_JUR") or "").strip().zfill(3)
            if not gnis or not parent:
                continue
            towns.append({"id": f"us-va-gnis-{gnis}", "name": name, "name_full": full or name, "kind": "town", "parent_id": f"us-va-fips-51{parent}", "bbox": bbox})
    localities.sort(key=lambda item: (item["name"], item["id"])); towns.sort(key=lambda item: (item["name"], item["id"]))
    ids = {item["id"] for item in localities}
    if len(ids) != len(localities) or len({item["id"] for item in towns}) != len(towns):
        raise ValueError("Favorites tree has duplicate IDs")
    if any(item["parent_id"] not in ids for item in towns):
        raise ValueError("Favorites tree has a town without a locality parent")
    return {"schema": "gremlin.favorites_tree.v1", "region": "virginia", "generated_at": retrieved_at, "source": {"id": "vdot_va_jurisdictions", "url": SOURCE_URL, "retrieved_at": retrieved_at}, "state": {"id": "us-va", "name": "Virginia"}, "localities": localities, "towns": towns}


def _bbox(coordinates):
    positions = list(_positions(coordinates))
    if not positions: return None
    lngs, lats = zip(*positions)
    return [round(min(lngs), 6), round(min(lats), 6), round(max(lngs), 6), round(max(lats), 6)]


def _positions(value):
    if isinstance(value, list) and len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
        yield value[0], value[1]
    elif isinstance(value, list):
        for child in value: yield from _positions(child)


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", type=Path, default=Path("motherbird/data/favorites_tree.v1.json")); args = parser.parse_args()
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    query = SOURCE_URL + "/query?where=1%3D1&outFields=STCOFIPS%2CGNIS%2CNAME%2CNAMELSAD%2CJURISTYPE%2CPARENT_JUR&returnGeometry=true&outSR=4326&f=geojson"
    with urlopen(Request(query, headers={"User-Agent": "MotherBird/1.0"}), timeout=75) as response: payload = json.loads(response.read())
    tree = build_tree(payload, now); args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(tree, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(tree['localities'])} localities and {len(tree['towns'])} towns")
    return 0

if __name__ == "__main__": raise SystemExit(main())
