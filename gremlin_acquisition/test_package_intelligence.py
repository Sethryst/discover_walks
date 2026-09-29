import unittest

from gremlin_acquisition.package_intelligence import POIRecord, deduplicate_pois, need_from_region_config, validate_region_geometry


class DeduplicationTests(unittest.TestCase):
    def test_region_geometry_rejects_outside_record(self):
        record = POIRecord('x', 'Outside', 'park', 'https://example.test', 46.0, -122.0)
        self.assertEqual(validate_region_geometry(record, (-123.0, 45.0, -121.0, 45.9)), ['geometry outside region bbox'])

    def test_region_config_bbox_is_normalized_from_lat_lon_order(self):
        need = need_from_region_config({
            'id': 'denver', 'name': 'Denver', 'bbox': [39.55, -105.16, 39.91, -104.6],
            'osm': {'categories': ['park']},
        })
        assert need.bbox == (-105.16, 39.55, -104.6, 39.91)
        assert validate_region_geometry(POIRecord('p', 'Park', 'park', 'https://city.gov', 39.7, -104.9), need.bbox) == []

    def record(self, record_id, name, lat=45.52, lon=-122.67):
        return POIRecord(record_id, name, "parks", "https://example.test/source", lat, lon)

    def test_cross_source_coordinate_drift_is_collapsed(self):
        unique, duplicates = deduplicate_pois([
            self.record("city-1", "River Park"),
            self.record("county-9", " river   park ", lat=45.5204, lon=-122.6703),
        ])
        self.assertEqual([row.record_id for row in unique], ["city-1"])
        self.assertEqual(duplicates, {unique[0].identity_key: ["county-9"]})

    def test_same_name_far_away_is_preserved(self):
        unique, duplicates = deduplicate_pois([
            self.record("west", "River Park"),
            self.record("east", "River Park", lat=45.54, lon=-122.67),
        ])
        self.assertEqual({row.record_id for row in unique}, {"west", "east"})
        self.assertEqual(duplicates, {})

    def test_duplicate_upstream_id_is_collapsed_without_geometry(self):
        unique, duplicates = deduplicate_pois([
            self.record("stable-1", "Park A", lat=None, lon=None),
            self.record("stable-1", "Park A renamed", lat=45.52, lon=-122.67),
        ])
        self.assertEqual(len(unique), 1)
        self.assertEqual(duplicates[unique[0].identity_key], ["stable-1"])


if __name__ == "__main__":
    unittest.main()
