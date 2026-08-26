"""Build lightweight tree-density products from curated tree point inventories.

Raw tree data stays in OpenData/{State}/{City}.  This script writes a compact
250 m grid for map rendering and route scoring, plus source-health metadata.
Canopy polygons receive a summary only because polygon area/overlap needs a
dedicated geometry engine before it can support an honest shade score.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

try:  # Supports both `python OpenData/tree_derivatives.py` and package imports.
    from scraper import DEFAULT_OUTPUT, spatial_summary
except ImportError:  # pragma: no cover - import mode depends on invocation
    from OpenData.scraper import DEFAULT_OUTPUT, spatial_summary


def point_coordinates(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if geometry.get("type") != "Point" or not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    lon, lat = coordinates[0], coordinates[1]
    if isinstance(lon, bool) or isinstance(lat, bool) or not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        return None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return float(lon), float(lat)


def build_density_grid(data: dict[str, Any], cell_size_m: int) -> dict[str, Any]:
    points = [point_coordinates(feature) for feature in data.get("features", [])]
    points = [point for point in points if point is not None]
    if not points:
        return {"type": "FeatureCollection", "features": []}
    mean_lat = sum(lat for _, lat in points) / len(points)
    lon_step = cell_size_m / (111_320 * max(math.cos(math.radians(mean_lat)), 0.01))
    lat_step = cell_size_m / 110_574
    cells: dict[tuple[int, int], int] = defaultdict(int)
    for lon, lat in points:
        cells[(math.floor(lon / lon_step), math.floor(lat / lat_step))] += 1
    features = []
    cell_area_hectares = cell_size_m * cell_size_m / 10_000
    for (x, y), count in sorted(cells.items()):
        west, south = x * lon_step, y * lat_step
        east, north = west + lon_step, south + lat_step
        features.append({
            "type": "Feature",
            "properties": {
                "tree_count": count,
                "trees_per_hectare": round(count / cell_area_hectares, 2),
                "cell_size_m": cell_size_m,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
            },
        })
    return {"type": "FeatureCollection", "features": features}


def build_one(input_path: Path, output_root: Path, cell_size_m: int) -> Path:
    data = json.loads(input_path.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise ValueError(f"{input_path} is not a GeoJSON FeatureCollection")
    relative = input_path.relative_to(output_root)
    destination = output_root / "derived" / relative.parent / f"{input_path.stem}_tree_density_{cell_size_m}m.geojson"
    destination.parent.mkdir(parents=True, exist_ok=True)
    grid = build_density_grid(data, cell_size_m)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_file": relative.as_posix(),
        "source_feature_count": len(data["features"]),
        "source_geometry": spatial_summary(data),
        "derived_feature_count": len(grid["features"]),
        "product": "tree_density_grid" if grid["features"] else "summary_only_non_point_source",
        "method": "Point records are aggregated into approximate WGS84 grid cells; this is density evidence, not measured canopy shade.",
    }
    destination.write_text(json.dumps({"type": "FeatureCollection", "features": grid["features"], "metadata": summary}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return destination


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+", help="Curated tree GeoJSON files under --output")
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
