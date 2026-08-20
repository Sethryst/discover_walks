"""Regression tests for reusable geographic boundary production."""

import json
import tempfile
import unittest
from pathlib import Path

from app.pipeline.export import build_release, write_bundle
from app.pipeline.geography import build_boundary_layer, verify_geographic_artifacts
from app.pipeline.source_config import SourceConfig


TIMESTAMP = "2026-08-19T00:00:00Z"


class GeographicBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = SourceConfig.from_dict({
            "id": "city-neighborhoods",
            "name": "City neighborhoods",
            "provider": "geojson",
            "url": "https://example.gov/neighborhoods.geojson",
            "domains": [],
            "layerRole": "neighborhood_boundaries",
            "artifactName": "neighborhoods.geojson",
            "propertyMapping": {"id": "code", "name": "label", "include": ["district"]},
            "licenseUrl": "https://example.gov/license",
            "attribution": "Example City GIS",
        })
        self.raw = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"code": "n-2", "label": "North", "district": 2}, "geometry": {"type": "Polygon", "coordinates": [[[-77.0, 38.9], [-77.0, 39.0], [-76.9, 39.0], [-77.0, 38.9]]]}},
            {"type": "Feature", "properties": {"code": "empty", "label": "Empty"}, "geometry": None},
        ]}

    def test_boundary_source_uses_explicit_mapping_and_drops_only_empty_geometry(self) -> None:
        artifact, warnings = build_boundary_layer(self.raw, self.source, "city-x", TIMESTAMP, Path("cache.json"))
        self.assertEqual(artifact["features"][0]["id"], "n-2")
        self.assertEqual(artifact["features"][0]["properties"], {"id": "n-2", "name": "North", "district": 2})
        self.assertEqual(artifact["metadata"]["layerRole"], "neighborhood_boundaries")
        self.assertEqual(warnings[0]["code"], "empty_geometry")

    def test_export_and_verifier_enforce_checksum_and_feature_count(self) -> None:
        artifact, _ = build_boundary_layer(self.raw, self.source, "city-x", TIMESTAMP, Path("cache.json"))
        release, manifest = build_release("city-x", [], [], "test", TIMESTAMP)
        manifest["geography"] = [{"role": "neighborhood_boundaries", "filename": "geography/neighborhoods.geojson", "featureCount": 1}]
        with tempfile.TemporaryDirectory() as directory:
            bundle = write_bundle(Path(directory), release, manifest, geography={"neighborhoods.geojson": artifact})
            self.assertEqual(verify_geographic_artifacts(bundle, manifest), {"geography/neighborhoods.geojson": 1})
            path = bundle / "geography" / "neighborhoods.geojson"
            path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify_geographic_artifacts(bundle, manifest)

    def test_boundary_config_requires_id_and_name_mapping(self) -> None:
        raw = {"id": "bad", "name": "Bad", "provider": "geojson", "url": "x", "layerRole": "neighborhood_boundaries", "licenseUrl": "x"}
        with self.assertRaisesRegex(ValueError, "propertyMapping"):
            SourceConfig.from_dict(raw)


if __name__ == "__main__":
    unittest.main()
