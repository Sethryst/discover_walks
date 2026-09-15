import json
from app.pipeline.walking_cells import FORMAT, generate_cell_plan, main

BOUNDARIES = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"STUSPS": "BB"}, "geometry": {"type": "Polygon", "coordinates": [[[0.2, 0.2], [1, 0.2], [1, 1], [0.2, 1], [0.2, 0.2]]]}},
    {"type": "Feature", "properties": {"STUSPS": "AA"}, "geometry": {"type": "Polygon", "coordinates": [[[-1, -1], [0.2, -1], [0.2, 0.2], [-1, 0.2], [-1, -1]]]}},
]}

def test_plan_is_deterministic_adaptive_overlapping_and_land_intersecting():
    first = generate_cell_plan(BOUNDARIES, "release-1", max_land_area_km2=4_000, overlap_km=5, min_zoom=5, max_zoom=9)
    assert first == generate_cell_plan(BOUNDARIES, "release-1", max_land_area_km2=4_000, overlap_km=5, min_zoom=5, max_zoom=9)
    assert first["format"] == FORMAT
    assert len({cell["tile"]["z"] for cell in first["cells"]}) > 1
    assert all(cell["states"] and cell["landAreaKm2"] > 0 for cell in first["cells"])
    assert all(cell["clipBounds"][0] < cell["bounds"][0] and cell["clipBounds"][2] > cell["bounds"][2] for cell in first["cells"])
    assert any(cell["states"] == ["aa", "bb"] for cell in first["cells"])

def test_cli_writes_stably_sorted_manifest(tmp_path):
    boundaries, output = tmp_path / "states.geojson", tmp_path / "plan.json"
    boundaries.write_text(json.dumps(BOUNDARIES), encoding="utf-8")
    assert main(["--boundaries", str(boundaries), "--release", "r1", "--output", str(output), "--max-land-area-km2", "2000", "--min-zoom", "5", "--max-zoom", "9"]) == 0
    plan = json.loads(output.read_text(encoding="utf-8"))
    assert [cell["id"] for cell in plan["cells"]] == sorted(cell["id"] for cell in plan["cells"])
