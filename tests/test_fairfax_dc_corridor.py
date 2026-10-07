import json
from pathlib import Path

REGISTRY = Path("published/national-routing/osm-us-2026-09-07/fairfax-dc-northeast-40/cells.json")

def test_fairfax_dc_corridor_is_contiguous_and_explicitly_stitched():
    registry = json.loads(REGISTRY.read_text())
    assert registry["corridor"]["cellCount"] == 40
    assert len(registry["cells"]) == 40
    assert all(c["neighbors"] == c["stitching"]["neighbors"] for c in registry["cells"])
    assert all(c["fallback"]["strategy"] == "nearest_verified_neighbor" for c in registry["cells"])
    assert sum(c["availability"] == "routing_available" for c in registry["cells"]) >= 0

def test_routing_available_cells_have_complete_binary_contract():
    registry = json.loads(REGISTRY.read_text())
    required = {"nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin", "manifest"}
    for cell in registry["cells"]:
        if cell["availability"] == "routing_available":
            assert required <= set(cell["artifacts"])
            assert all(len(cell["artifacts"][name]["sha256"]) == 64 for name in required if name != "manifest")
