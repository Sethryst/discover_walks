"""Deterministic planning of overlapping, land-intersecting routing cells."""
from __future__ import annotations
import argparse, json, math
from pathlib import Path
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union

FORMAT = "motherbird-walking-cell-plan-v1"
EARTH_RADIUS_M = 6_378_137.0
MAX_MERCATOR_LAT = 85.05112878

def _mercator(x, y, z=None):
    y = max(-MAX_MERCATOR_LAT, min(MAX_MERCATOR_LAT, y))
    point = (math.radians(x) * EARTH_RADIUS_M, EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(y) / 2)))
    return (*point, z) if z is not None else point

def _tile_bounds(z, x, y):
    scale = 2**z
    west, east = x / scale * 360 - 180, (x + 1) / scale * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / scale))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / scale))))
    return west, south, east, north

def _covering_tiles(bounds, zoom):
    west, south, east, north = bounds
    scale = 2**zoom
    x0, x1 = max(0, math.floor((west + 180) / 360 * scale)), min(scale - 1, math.floor((east + 180 - 1e-12) / 360 * scale))
    def tile_y(lat):
        lat = max(-MAX_MERCATOR_LAT, min(MAX_MERCATOR_LAT, lat))
        return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * scale
    y0, y1 = max(0, math.floor(tile_y(north))), min(scale - 1, math.floor(tile_y(south) - 1e-12))
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1): yield zoom, x, y

def generate_cell_plan(boundary_collection, release, *, max_land_area_km2=4_000, overlap_km=5, min_zoom=4, max_zoom=10, source_template="state-pbf/{state}.pedestrian.osm.pbf"):
    """Return a stable quadtree plan; empty ocean tiles are never emitted."""
    if max_land_area_km2 <= 0 or overlap_km < 0 or not (0 <= min_zoom <= max_zoom <= 20):
        raise ValueError("Invalid walking-cell planning parameters.")
    states = []
    for feature in boundary_collection.get("features", []):
        code = str(feature.get("properties", {}).get("STUSPS", "")).lower()
        if not code or code in {"as", "gu", "mp", "pr", "vi"}: continue
        geometry = shape(feature["geometry"])
        if not geometry.is_empty: states.append((code, geometry))
    states.sort(key=lambda item: item[0])
    if not states: raise ValueError("No supported state boundaries were found.")
    land = unary_union([geometry for _, geometry in states])
    threshold_m2, leaves = max_land_area_km2 * 1_000_000, []
    def visit(z, x, y):
        bounds = _tile_bounds(z, x, y)
        intersection = land.intersection(box(*bounds))
        if intersection.is_empty or intersection.area == 0: return
        land_area_m2 = transform(_mercator, intersection).area
        if z < max_zoom and land_area_m2 > threshold_m2:
            for child_x in (x * 2, x * 2 + 1):
                for child_y in (y * 2, y * 2 + 1): visit(z + 1, child_x, child_y)
            return
        lat_pad = overlap_km / 110.574
        center_lat = (bounds[1] + bounds[3]) / 2
        lon_pad = overlap_km / (111.320 * max(0.01, math.cos(math.radians(center_lat))))
        clip_bounds = [max(-180, bounds[0] - lon_pad), max(-MAX_MERCATOR_LAT, bounds[1] - lat_pad), min(180, bounds[2] + lon_pad), min(MAX_MERCATOR_LAT, bounds[3] + lat_pad)]
        clip = box(*clip_bounds)
        codes = [code for code, geometry in states if geometry.intersects(clip)]
        cell_id = f"z{z}-{x}-{y}"
        leaves.append({"id": cell_id, "tile": {"z": z, "x": x, "y": y}, "bounds": [round(v, 7) for v in bounds], "clipBounds": [round(v, 7) for v in clip_bounds], "landAreaKm2": round(land_area_m2 / 1_000_000, 3), "states": codes, "sourcePbf": [source_template.format(state=c) for c in codes], "output": f"cells/{cell_id}"})
    for root in sorted(set(_covering_tiles(land.bounds, min_zoom))): visit(*root)
    leaves.sort(key=lambda cell: cell["id"])
    return {"format": FORMAT, "release": release, "parameters": {"maxLandAreaKm2": max_land_area_km2, "overlapKm": overlap_km, "minZoom": min_zoom, "maxZoom": max_zoom}, "cells": leaves}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boundaries", required=True, type=Path); parser.add_argument("--release", required=True); parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-land-area-km2", type=float, default=4_000); parser.add_argument("--overlap-km", type=float, default=5); parser.add_argument("--min-zoom", type=int, default=4); parser.add_argument("--max-zoom", type=int, default=10)
    args = parser.parse_args(argv)
    plan = generate_cell_plan(json.loads(args.boundaries.read_text(encoding="utf-8")), args.release, max_land_area_km2=args.max_land_area_km2, overlap_km=args.overlap_km, min_zoom=args.min_zoom, max_zoom=args.max_zoom)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0

if __name__ == "__main__": raise SystemExit(main())
