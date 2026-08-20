"""Write a persistent, structured civic expansion queue."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.scout.engine import ScoutEngine


def main() -> int:
    parser = argparse.ArgumentParser(description="Rank civic source opportunities without approving or executing them.")
    parser.add_argument("region_id")
    parser.add_argument("--workspace", type=Path, default=Path("."))
    parser.add_argument("--discovery", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    discovery_path = args.discovery or args.workspace / "app" / "scout" / "leads" / f"{args.region_id}.json"
    output_path = args.output or args.workspace / "expansion-queues" / f"{args.region_id}.json"
    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
    queue = ScoutEngine(args.workspace).run(args.region_id, discovery)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(queue, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
