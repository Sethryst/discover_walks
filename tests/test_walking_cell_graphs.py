import json
from app.pipeline.walking_cell_graphs import compile_features, deduplicate_osm_features, osm_identity

CELL = {"id": "z1-0-0", "bounds": [-1, -1, 1, 1]}

def way(object_id="way/7", version=1, coordinates=None):
    return {"type": "Feature", "id": object_id, "properties": {"highway": "footway", "@version": version}, "geometry": {"type": "LineString", "coordinates": coordinates or [[0, 0], [0.001, 0]]}}

def test_osmium_area_identity_maps_back_to_source_object():
    assert osm_identity({"id": "area/14"}) == ("way", 7)
    assert osm_identity({"id": "area/15"}) == ("relation", 7)
    assert osm_identity({"id": "w7"}) == ("way", 7)

def test_overlapping_shards_deduplicate_same_osm_object_and_keep_newest():
    features, removed = deduplicate_osm_features([way(version=1), way(version=2)])
    assert removed == 1
    assert features[0]["properties"]["@version"] == 2

def test_graph_is_deterministic_and_reports_deduplication():
    inputs = [way(), way(), way("way/8", coordinates=[[0.001, 0], [0.002, 0]])]
    first = compile_features(inputs, CELL, "r1")
    assert first == compile_features(reversed(inputs), CELL, "r1")
    assert first["duplicate_objects_removed"] == 1
    assert len(first["nodes"]) == 3 and len(first["edges"]) == 2

def test_private_and_nonwalking_ways_are_not_routable():
    private = way(); private["properties"]["foot"] = "private"
    road = way("way/9"); road["properties"]["highway"] = "motorway"
    assert compile_features([private, road], CELL, "r1")["edges"] == []
