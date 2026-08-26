"""Build map-ready streetlight-density grids from verified point inventories.

Inputs must be municipal streetlight/lamp-post inventories, not 311 reports.
The output is an infrastructure-availability proxy: it does *not* measure
illumination, brightness, outages, obstructions, or pedestrian safety.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

try:  # Supports both direct execution and package imports.
    from scraper import DEFAULT_OUTPUT, spatial_summary
    from tree_derivatives import build_density_grid
except ImportError:  # pragma: no cover - import mode depends on invocation
    from OpenData.scraper import DEFAULT_OUTPUT, spatial_summary
    from OpenData.tree_derivatives import build_density_grid


def build_one(input_path: Path, output_root: Path, cell_size_m: int) -> Path:
    data = json.loads(input_path.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise ValueError(f"{input_path} is not a GeoJSON FeatureCollection")
    relative = input_path.relative_to(output_root)
    destination = output_root / "derived" / relative.parent / f"{input_path.stem}_streetlight_density_{cell_size_m}m.geojson"
    destination.parent.mkdir(parents=True, exist_ok=True)
    grid = build_density_grid(data, cell_size_m)
    for feature in grid["features"]:
        properties = feature["properties"]
        properties["streetlight_count"] = properties.pop("tree_count")
        properties["streetlights_per_hectare"] = properties.pop("trees_per_hectare")
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_file": relative.as_posix(),
        "source_feature_count": len(data["features"]),
        "source_geometry": spatial_summary(data),
        "derived_feature_count": len(grid["features"]),
        "product": "streetlight_density_grid" if grid["features"] else "summary_only_non_point_source",
        "method": "Verified streetlight point records are aggregated into approximate WGS84 grid cells.",
        "limitation": "A streetlight count is an availability proxy, not a measurement of illumination, lighting quality, outage state, or safety.",
    }
    destination.write_text(
        json.dumps({"type": "FeatureCollection", "features": grid["features"], "metadata": summary}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return destination


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+", help="Verified streetlight-inventory GeoJSON files below --output")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cell-size-m", type=int, default=250)
    args = parser.parse_args(argv)
    root = args.output.resolve()
    if args.cell_size_m < 25:
        raise SystemExit("--cell-size-m must be at least 25")
    for input_path in args.files:
        resolved = input_path.resolve()
        if root not in resolved.parents:
            raise SystemExit(f"Input must be below output root: {resolved}")
        print(build_one(resolved, root, args.cell_size_m))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
