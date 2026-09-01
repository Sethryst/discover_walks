"""CLI for walker-visible regional pack sidecars."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.pipeline.furnish import furnish_region


def main() -> int:
    parser = argparse.ArgumentParser(description="Furnish an existing regional release for Motherbird.")
    parser.add_argument("region_id")
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--install-root", type=Path)
    args = parser.parse_args()
    print(json.dumps(furnish_region(args.region_id, args.output, args.install_root), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
