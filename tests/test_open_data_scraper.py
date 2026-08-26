import json
import unittest
import json
import tempfile
from pathlib import Path
from pathlib import Path
from tempfile import TemporaryDirectory

from OpenData.scraper import (
    ArcGISAdapter,
    Candidate,
    CrawlError,
    Portal,
    SocrataAdapter,
    keyword_score,
    safe_component,
    spatial_summary,
    valid_feature_collection,
    write_geojson_exclusive,
    parse_bbox,
    load_datasets,
)


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def json(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response, object()


class QuietLogger:
    def debug(self, *args, **kwargs):
        pass


class ScraperTests(unittest.TestCase):

    def test_portal_bbox_parser_enforces_wgs84_order(self):
        self.assertEqual(parse_bbox("34.80|-111.86|34.93|-111.70"), (34.8, -111.86, 34.93, -111.7))
        with self.assertRaisesRegex(ValueError, "inverted"):
            parse_bbox("34.93|-111.86|34.80|-111.70")

    def test_dataset_selector_registry_keeps_legacy_dataset_schema(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "datasets.csv").write_text(
                "State,City,Platform,Dataset_ID,Dataset_Name,Source_URL,File,Status,Last_Observed_Feature_Count,Last_Checked,Notes\n"
                "Colorado,Keystone,ArcGIS,abc_15,Trails,https://example.test/FeatureServer/15,Colorado/Keystone/trails.geojson,curated,3,2026-08-26,Current\n",
                encoding="utf-8",
            )
            (root / "dataset_selectors.csv").write_text(
                "State,City,Platform,Dataset_ID,Query_Where,BBox_WGS84\n"
                "Colorado,Keystone,ArcGIS,abc_15,hiking = 'yes',39.53|-106.10|39.72|-105.82\n",
                encoding="utf-8",
            )
            record = load_datasets(root / "datasets.csv")[0]
            self.assertEqual(record.query_where, "hiking = 'yes'")
            self.assertEqual(record.bbox, (39.53, -106.1, 39.72, -105.82))

    def test_streetlight_product_is_explicit_proxy(self):
        from OpenData.streetlight_derivatives import build_one

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "OpenData"
            source = root / "Example" / "City" / "streetlights.geojson"
            source.parent.mkdir(parents=True)
            source.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [-71.1, 42.3]}}]}), encoding="utf-8")
            output = build_one(source, root, 250)
            product = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(product["metadata"]["product"], "streetlight_density_grid")
            self.assertIn("not a measurement of illumination", product["metadata"]["limitation"])
            self.assertEqual(product["features"][0]["properties"]["streetlight_count"], 1)
    def test_keyword_matching_uses_word_boundaries(self):
        self.assertGreaterEqual(keyword_score("Neighborhood Parks"), 4)
        self.assertEqual(keyword_score("Downtown Parking Meters"), 0)
        self.assertGreater(keyword_score("Public Art Locations"), keyword_score("Capital Project List"))

    def test_operational_and_measurement_titles_are_not_candidates(self):
        sidewalk_widths = Candidate("Socrata", "abcd-1234", "Sidewalk Widths 2014", "", "")
        permits = Candidate("Socrata", "abcd-1234", "Sidewalk Cafe Permits", "", "")
        administrative = Candidate("Socrata", "abcd-1234", "Administrative Applications Reviewed", "", "")
        deprecated = Candidate("Socrata", "abcd-1234", "Parks - Locations (deprecated November 2016)", "", "")
        outage = Candidate("Socrata", "abcd-1234", "Street Lights - All Out 311 Requests", "", "")
        lights = Candidate("Socrata", "abcd-1234", "Street Light Inventory", "", "")
        parks = Candidate("Socrata", "abcd-1234", "Parks and Recreation Facilities", "", "")
        from OpenData.scraper import is_relevant

        self.assertFalse(is_relevant(sidewalk_widths))
        self.assertFalse(is_relevant(permits))
        self.assertFalse(is_relevant(administrative))
        self.assertFalse(is_relevant(deprecated))
        self.assertFalse(is_relevant(outage))
        self.assertTrue(is_relevant(lights))
        self.assertTrue(is_relevant(parks))

    def test_geojson_validation_rejects_empty_and_null_geometry(self):
        self.assertFalse(valid_feature_collection({"type": "FeatureCollection", "features": []})[0])
        null_only = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": None, "properties": {}}],
        }
        self.assertFalse(valid_feature_collection(null_only)[0])
        valid = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}}],
        }
        self.assertTrue(valid_feature_collection(valid)[0])

    def test_geojson_validation_rejects_coordinates_outside_wgs84(self):
        invalid = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [500, 0]}}],
        }
        valid, detail = valid_feature_collection(invalid)
        self.assertFalse(valid)
        self.assertIn("outside WGS84 bounds", detail)

    def test_spatial_summary_records_geometry_bounds_and_coordinates(self):
        data = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-77.1, 38.8]}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-77.0, 38.9]}},
            ],
        }
        summary = spatial_summary(data)
        self.assertEqual(summary["geometry_types"], "Point")
        self.assertEqual(summary["coordinate_count"], 2)
        self.assertEqual(summary["bbox_wgs84"], "-77.100000,38.800000,-77.000000,38.900000")

    def test_safe_component_blocks_path_separators(self):
        self.assertEqual(safe_component("New/York"), "New_York")
        self.assertEqual(safe_component(".."), "unknown")

    def test_exclusive_writer_never_overwrites(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "parks.geojson"
            original = {"type": "FeatureCollection", "features": []}
            write_geojson_exclusive(path, original)
            with self.assertRaisesRegex(CrawlError, "refusing to overwrite"):
                write_geojson_exclusive(path, {"type": "FeatureCollection", "features": [{"id": 1}]})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), original)

    def test_socrata_validation_requires_native_geometry(self):
        http = FakeHttp([{
            "id": "abcd-1234",
            "viewType": "tabular",
            "columns": [{"fieldName": "name", "dataTypeName": "text"}],
        }])
        adapter = SocrataAdapter(http, QuietLogger())
        portal = Portal("X", "Y", "https://data.example.gov", "Socrata")
        candidate = Candidate("Socrata", "abcd-1234", "Parks", "", "")
        with self.assertRaises(CrawlError) as error:
            adapter.validate(portal, candidate)
        self.assertEqual(error.exception.reason, "not_geospatial")

    def test_socrata_download_checks_count_and_combines_pages(self):
        feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}}
        http = FakeHttp([
            [{"count": "2"}],
            {"type": "FeatureCollection", "features": [feature]},
            {"type": "FeatureCollection", "features": [feature]},
        ])
        adapter = SocrataAdapter(http, QuietLogger())
        portal = Portal("X", "Y", "https://data.example.gov", "Socrata")
        candidate = Candidate("Socrata", "abcd-1234", "Parks", "", "")
        result = adapter.download(portal, candidate, max_features=10, page_size=1)
        self.assertEqual(result["feature_count"], 2)
        self.assertEqual(http.calls[1][1]["params"]["$offset"], 0)
        self.assertEqual(http.calls[2][1]["params"]["$offset"], 1)

    def test_arcgis_layer_validation_checks_geojson_capability(self):
        adapter = ArcGISAdapter(FakeHttp([]), QuietLogger())
        candidate = Candidate("ArcGIS", "a" * 32, "City Parks", "", "https://example/FeatureServer")
        metadata = {
            "geometryType": "esriGeometryPolygon",
            "capabilities": "Query,Extract",
            "supportedQueryFormats": "JSON,geoJSON,PBF",
            "hasM": False,
        }
        self.assertEqual(
            adapter.validate_layer(candidate, 0, "Parks", metadata, 1),
            "esriGeometryPolygon",
        )
        metadata["hasM"] = True
        self.assertEqual(
            adapter.validate_layer(candidate, 0, "Parks", metadata, 1),
            "esriGeometryPolygon",
        )
        metadata["supportedQueryFormats"] = "JSON"
        with self.assertRaises(CrawlError) as error:
            adapter.validate_layer(candidate, 0, "Parks", metadata, 1)
        self.assertEqual(error.exception.reason, "geojson_unsupported")

    def test_exact_direct_layer_is_allowlisted_even_with_planning_title(self):
        adapter = ArcGISAdapter(FakeHttp([]), QuietLogger())
        candidate = Candidate(
            "ArcGIS", "a" * 32, "Boise Pathways Master Plan", "", "https://example/FeatureServer/0",
            direct=True,
        )
        metadata = {
            "geometryType": "esriGeometryPolyline",
            "capabilities": "Query",
            "supportedQueryFormats": "JSON,geoJSON",
        }
        self.assertEqual(
            adapter.validate_layer(candidate, 0, "Boise Pathways Master Plan", metadata, 1),
            "esriGeometryPolyline",
        )

    def test_multilayer_arcgis_service_does_not_inherit_parent_trail_tags(self):
        adapter = ArcGISAdapter(FakeHttp([]), QuietLogger())
        candidate = Candidate(
            "ArcGIS", "a" * 32, "Community", "Contains trails", "https://example/MapServer",
            tags=("trail",),
        )
        metadata = {
            "geometryType": "esriGeometryPoint",
            "capabilities": "Query",
            "supportedQueryFormats": "JSON,geoJSON",
        }
        with self.assertRaises(CrawlError) as error:
            adapter.validate_layer(candidate, 0, "Hospitals and Clinics", metadata, 3)
        self.assertEqual(error.exception.reason, "irrelevant_layer")

    def test_arcgis_download_uses_object_id_batches(self):
        features = [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [value, 0]}}
            for value in range(3)
        ]
        http = FakeHttp([
            {"maxRecordCount": 2},
            {"objectIds": [10, 11, 12]},
            {"type": "FeatureCollection", "features": features[:2]},
            {"type": "FeatureCollection", "features": features[2:]},
        ])
        adapter = ArcGISAdapter(http, QuietLogger())
        candidate = Candidate("ArcGIS", "a" * 32, "Parks", "", "https://example/FeatureServer")
        result = adapter.download_layer(candidate, 0, max_features=10, page_size=2)
        self.assertEqual(result["feature_count"], 3)
        self.assertEqual(http.calls[2][1]["method"], "POST")
        self.assertEqual(http.calls[2][1]["params"]["objectIds"], "10,11")
        self.assertEqual(result["quality"]["coverage_status"], "complete")

    def test_arcgis_selector_applies_where_and_bbox_to_object_ids(self):
        feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-105.95, 39.61]}}
        http = FakeHttp([
            {"maxRecordCount": 2000},
            {"objectIds": [10]},
            {"type": "FeatureCollection", "features": [feature]},
        ])
        adapter = ArcGISAdapter(http, QuietLogger())
        candidate = Candidate("ArcGIS", "a" * 32, "Trails", "", "https://example/FeatureServer/15")
        adapter.download_layer(candidate, 15, 10, 10, "hiking = 'yes'", (39.53, -106.10, 39.72, -105.82))
        params = http.calls[1][1]["params"]
        self.assertEqual(params["where"], "hiking = 'yes'")
        self.assertEqual(params["geometry"], "-106.1,39.53,-105.82,39.72")
        self.assertEqual(params["geometryType"], "esriGeometryEnvelope")

    def test_socrata_retains_usable_geometry_and_reports_incomplete_coverage(self):
        valid = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}}
        invalid = {"type": "Feature", "geometry": None, "properties": {}}
        http = FakeHttp([
            [{"count": "2"}],
            {"type": "FeatureCollection", "features": [valid, invalid]},
        ])
        adapter = SocrataAdapter(http, QuietLogger())
        portal = Portal("X", "Y", "https://data.example.gov", "Socrata")
        candidate = Candidate("Socrata", "abcd-1234", "Parks", "", "")
        result = adapter.download(portal, candidate, max_features=10, page_size=2)
        self.assertEqual(result["feature_count"], 1)
        self.assertEqual(result["quality"]["expected_count"], 2)
        self.assertEqual(result["quality"]["invalid_feature_count"], 1)
        self.assertEqual(result["quality"]["coverage_status"], "incomplete")


if __name__ == "__main__":
    unittest.main()
