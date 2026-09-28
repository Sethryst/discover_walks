import unittest

from gremlin_acquisition.package_intelligence import POIRecord, deduplicate_pois


class DeduplicationTests(unittest.TestCase):
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
