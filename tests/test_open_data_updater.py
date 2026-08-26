import json
import logging
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from OpenData.scraper import CrawlError, DatasetRecord
from OpenData.updater import destination, refresh_record, replace_geojson_atomically


class FakeHttp:
    timeout = 1

    def __init__(self, responses):
        self.responses = list(responses)

    def json(self, url, **kwargs):
        return self.responses.pop(0), object()


class UpdaterTests(unittest.TestCase):
    def test_destination_rejects_registry_path_escape(self):
        with TemporaryDirectory() as directory:
            with self.assertRaises(CrawlError):
                destination(Path(directory).resolve(), "../outside.geojson")

    def test_atomic_replace_leaves_complete_geojson(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "parks.geojson"
            path.write_text('{"old":true}', encoding="utf-8")
            data = {"type": "FeatureCollection", "features": []}
            replace_geojson_atomically(path, data)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), data)

    def test_direct_socrata_refresh_uses_registry_without_discovery(self):
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-77.0, 38.9]},
            "properties": {"name": "Test park"},
        }
        http = FakeHttp([
            {
                "id": "abcd-1234", "viewType": "tabular",
                "columns": [{"dataTypeName": "point"}],
            },
            [{"count": "1"}],
            {"type": "FeatureCollection", "features": [feature]},
        ])
        record = DatasetRecord(
            "Virginia", "Test City", "Socrata", "abcd-1234", "Parks",
            "https://data.example.gov/resource/abcd-1234.geojson",
            "Virginia/Test City/parks_abcd-1234.geojson", "curated",
        )
        with TemporaryDirectory() as directory:
            args = SimpleNamespace(
                output=Path(directory), dry_run=False, max_features=10,
                page_size=10, min_previous_ratio=0.8,
            )
            result, changed = refresh_record(record, args, http, logging.getLogger("test"))
            self.assertTrue(changed)
            self.assertEqual(result.status, "success")
            self.assertEqual(result.feature_count, 1)
            self.assertTrue((Path(directory) / record.file).is_file())


if __name__ == "__main__":
    unittest.main()
