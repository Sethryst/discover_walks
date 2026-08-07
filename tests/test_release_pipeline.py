"""Offline regression tests for the public regional release contract."""

import json
import tempfile
import unittest
from pathlib import Path

from app.pipeline.contracts import ContractError, validate_release
from app.pipeline.civic import _validate_items, attach_civic_artifacts, load_civic_artifacts
from app.pipeline.export import build_release, write_bundle
from app.pipeline.normalization import normalize_overpass
from app.pipeline.batch import build_batch


FIXTURE = Path(__file__).parent / "fixtures" / "norfolk_overpass.json"
TIMESTAMP = "2026-08-05T00:00:00Z"


class ReleasePipelineTests(unittest.TestCase):
    def test_fixture_build_is_stable_and_contract_valid(self) -> None:
        elements = json.loads(FIXTURE.read_text(encoding="utf-8"))["elements"]
        pois, warnings = normalize_overpass(elements)
        release, manifest = build_release("norfolk", pois, warnings, "test", TIMESTAMP)

        validate_release(release)
        self.assertEqual(release["pois"], sorted(release["pois"], key=lambda poi: poi["id"]))
        self.assertTrue(all(poi["id"].startswith("osm:") for poi in release["pois"]))
        with tempfile.TemporaryDirectory() as directory:
            write_bundle(Path(directory), release, manifest)
        self.assertIn("pois.json", manifest["checksums"])

    def test_writer_contains_only_public_release_and_manifest(self) -> None:
        release, manifest = build_release("norfolk", [], [], "test", TIMESTAMP)
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            write_bundle(destination, release, manifest)
            bundle = destination / "norfolk"
            self.assertEqual({path.name for path in bundle.iterdir()}, {"pois.json", "producer-manifest.json"})

    def test_invalid_coordinate_is_rejected(self) -> None:
        release, _ = build_release("norfolk", [], [], "test", TIMESTAMP)
        release["pois"] = [{"id": "x", "name": "x", "lat": 91, "lng": 0, "category": "park"}]
        with self.assertRaises(ContractError):
            validate_release(release)

    def test_reviewed_civic_artifacts_are_checksummed(self) -> None:
        release, manifest = build_release("nyc", [], [], "test", TIMESTAMP)
        civic = load_civic_artifacts("nyc", "test", TIMESTAMP)
        with tempfile.TemporaryDirectory() as directory:
            write_bundle(Path(directory), release, manifest, civic=civic)
            artifact = Path(directory) / "nyc" / "civic" / "vote.json"
            self.assertTrue(artifact.exists())
            self.assertIn("civic/vote.json", manifest["checksums"])

    def test_civic_can_attach_without_rebuilding_pois(self) -> None:
        release, manifest = build_release("nyc", [], [], "test", TIMESTAMP)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_bundle(root, release, manifest)
            attach_civic_artifacts(root / "nyc", load_civic_artifacts("nyc", "test", TIMESTAMP))
            updated = json.loads((root / "nyc" / "producer-manifest.json").read_text(encoding="utf-8"))
            self.assertIn("civic/vote.json", updated["checksums"])

    def test_volunteer_context_requires_plain_language_commitment(self) -> None:
        item = {"id": "org:cleanup", "title": "Park cleanup", "summary": "Help clean a park.", "timeCommitment": "Two hours", "officialUrl": "https://example.gov/cleanup", "source": {"url": "https://example.gov/cleanup"}, "organizer": {"id": "org:parks", "name": "Parks Department"}, "barriers": {"weekdayDaytime": False, "transitAccessible": True, "childcareProvided": False}, "participation": {"whatYouWillDo": "Collect litter.", "timeCommitment": "Two hours", "riskClarity": "Outdoor work; bring water."}}
        _validate_items("volunteer", [item])

    def test_batch_ignores_non_region_source_registries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "editorial-event-sources.json").write_text('{"schemaVersion": 1, "regions": {}}', encoding="utf-8")
            result = build_batch(root, root / "out", root / "cache", "test")
            self.assertEqual(result, {"completed": {}, "failed": {}})
