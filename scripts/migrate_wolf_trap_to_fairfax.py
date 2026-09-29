"""Move Wolf Trap's governed sources and backlog queue under Fairfax County."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main() -> None:
    fairfax_path = ROOT / "app/regions/fairfax-county-va.json"
    wolf_path = ROOT / "app/regions/wolf-trap-va.json"
    fairfax = json.loads(fairfax_path.read_text(encoding="utf-8"))
    wolf = json.loads(wolf_path.read_text(encoding="utf-8"))
    known = {source["id"] for source in fairfax.get("sources", [])}
    fairfax.setdefault("sources", []).extend(source for source in wolf.get("sources", []) if source["id"] not in known)
    fairfax_path.write_text(json.dumps(fairfax, indent=2) + "\n", encoding="utf-8")

    backlog_path = ROOT / "expansion-queues/regional-source-backlog.json"
    backlog = json.loads(backlog_path.read_text(encoding="utf-8"))
    fairfax_region = next(region for region in backlog["regions"] if region["id"] == "fairfax-county-va")
    wolf_regions = [region for region in backlog["regions"] if region["id"] == "wolf-trap-va"]
    for region in wolf_regions:
        fairfax_region["queue"].extend(region.get("queue", []))
    backlog["regions"] = [region for region in backlog["regions"] if region["id"] != "wolf-trap-va"]
    backlog["summary"]["regionCount"] = len(backlog["regions"])
    backlog_path.write_text(json.dumps(backlog, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"fairfaxSources": len(fairfax["sources"]), "fairfaxQueue": len(fairfax_region["queue"]), "regions": len(backlog["regions"])}))

if __name__ == "__main__": main()
