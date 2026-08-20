"""Journey packages preserve POIs and expose only validated route geometry."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.pipeline.journey_builder import build_journeys


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


class JourneyBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def seed_bundle(self, geometry: dict[str, object], *, with_source: bool = True) -> Path:
        bundle = self.root / "test-region"
        poi = {"id": "park:seed:1", "name": "Seed Park", "lat": 38.9, "lng": -77.0, "category": "park"}
        release = {
            "schemaVersion": 1,
            "regionId": "test-region",
            "generatedAt": "2026-08-07T12:00:00Z",
            "producer": {"name": "Gremlin Lab", "version": "test"},
            "pois": [poi],
        }
        sources = [{"sourceId": "osm", "sourceName": "OpenStreetMap", "sourceUrl": "https://www.openstreetmap.org", "confidence": "high"}] if with_source else []
        records = [{
            "id": "route:osm:1",
            "name": "Source Trail",
            "domain": "route",
            "geometry": geometry,
            "properties": {"estimatedDistanceMeters": 800},
            "sources": sources,
        }]
        _write(bundle / "pois.json", release)
        _write(bundle / "producer-manifest.json", {"schemaVersion": 1, "regionId": "test-region", "warnings": [], "checksums": {"pois.json": "unchanged"}})
        _write(bundle / "supplemental" / "canonical-records.json", records)
        return bundle

    def editorial(self) -> Path:
        path = self.root / "editorial.json"
        _write(path, {
            "schemaVersion": 1,
            "regionId": "test-region",
            "routes": [{
                "id": "short-walk",
                "name": "Short Walk",
                "chapters": [{"id": "short-part", "name": "Short Part", "canonicalRecordId": "route:osm:1"}],
            }],
        })
        return path

    def test_build_is_additive_and_checksum_is_manifested(self) -> None:
        bundle = self.seed_bundle({"type": "LineString", "coordinates": [[-77.0, 38.9], [-76.99, 38.91]]})
        original_pois = (bundle / "pois.json").read_bytes()

        result = build_journeys("test-region", self.editorial(), self.root)

        self.assertEqual(result["journeys"], 1)
        self.assertEqual(result["chapters"], 1)
        self.assertEqual(result["cityPoisPreserved"], 1)
        self.assertEqual((bundle / "pois.json").read_bytes(), original_pois)
        package_bytes = (bundle / "supplemental" / "journeys.json").read_bytes()
        package = json.loads(package_bytes)
        self.assertEqual(package["pois"], package["pointsOfInterest"])
        self.assertEqual(package["pois"][0]["name"], "Seed Park")
        chapter = package["journeys"][0]["chapters"][0]
        self.assertTrue(chapter["renderable"])
        self.assertEqual(chapter["geometry"]["type"], "LineString")
        self.assertEqual(len(chapter["geometry"]["coordinates"]), 2)
        self.assertFalse(chapter["geometryProvenance"]["generatedEstimate"])
        manifest = json.loads((bundle / "producer-manifest.json").read_text(encoding="utf-8"))
        expected = f"sha256:{hashlib.sha256(package_bytes).hexdigest()}"
        self.assertEqual(manifest["checksums"]["supplemental/journeys.json"], expected)

    def test_empty_geometry_is_not_exported_as_renderable(self) -> None:
        bundle = self.seed_bundle({"type": "LineString", "coordinates": []})

        result = build_journeys("test-region", self.editorial(), self.root)

        package = json.loads((bundle / "supplemental" / "journeys.json").read_text(encoding="utf-8"))
        self.assertEqual(result["journeys"], 0)
        self.assertEqual(result["chapters"], 0)
        self.assertEqual(package["journeys"], [])
        self.assertEqual({warning["code"] for warning in package["warnings"]}, {"journey_geometry_invalid", "journey_not_renderable"})

    def test_missing_geometry_provenance_is_not_renderable(self) -> None:
        bundle = self.seed_bundle({"type": "LineString", "coordinates": [[-77.0, 38.9], [-76.99, 38.91]]}, with_source=False)

        result = build_journeys("test-region", self.editorial(), self.root)

        self.assertEqual(result["journeys"], 0)
        package = json.loads((bundle / "supplemental" / "journeys.json").read_text(encoding="utf-8"))
        self.assertEqual(package["journeys"], [])
        self.assertEqual(package["warnings"][0]["code"], "journey_provenance_missing")

    def test_dry_run_does_not_write_or_change_manifest(self) -> None:
        bundle = self.seed_bundle({"type": "LineString", "coordinates": [[-77.0, 38.9], [-76.99, 38.91]]})
        original_manifest = (bundle / "producer-manifest.json").read_bytes()

        result = build_journeys("test-region", self.editorial(), self.root, dry_run=True)

        self.assertTrue(result["dryRun"])
        self.assertFalse((bundle / "supplemental" / "journeys.json").exists())
        self.assertEqual((bundle / "producer-manifest.json").read_bytes(), original_manifest)


if __name__ == "__main__":
    unittest.main()
