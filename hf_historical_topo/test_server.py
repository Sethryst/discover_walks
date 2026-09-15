from server import tile_bbox, overlaps

def test_world_tile():
    assert tile_bbox(0, 0, 0) == (-180, -85.0511287798066, 180, 85.0511287798066)

def test_overlap():
    assert overlaps((0, 0, 2, 2), (1, 1, 3, 3))
    assert not overlaps((0, 0, 1, 1), (1, 1, 2, 2))
