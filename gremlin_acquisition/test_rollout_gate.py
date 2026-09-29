import unittest

from gremlin_acquisition.rollout_gate import evaluate_region_gate, evaluate_review_package_gate


class RolloutGateTests(unittest.TestCase):
    def test_portland_needs_human_toggle_after_automated_pass(self):
        gate = evaluate_region_gate(region_id="replay-portland", region_name="Portland",
                                    adapter_status="SUCCEEDED", accepted_count=4,
                                    coverage_gaps=[], duplicate_count=0,
                                    validation_errors=[])
        self.assertTrue(gate["automatedReady"])
        self.assertFalse(gate["canAdvance"])

    def test_low_quality_blocks_automated_readiness(self):
        gate = evaluate_region_gate(region_id="x", region_name="X", adapter_status="SUCCEEDED",
                                    accepted_count=2, coverage_gaps=[], quality_scores=[0.55])
        self.assertFalse(gate["automatedReady"])
        self.assertIn("quality", gate["blockers"])

    def test_missing_license_evidence_blocks_governed_readiness(self):
        gate = evaluate_region_gate(region_id="x", region_name="X", adapter_status="SUCCEEDED",
                                    accepted_count=2, coverage_gaps=[], source_metadata=[{'url': 'https://city.gov/data'}])
        self.assertFalse(gate["automatedReady"])
        self.assertIn("sourceEvidence", gate["blockers"])

    def test_package_gate_consumes_review_artifact_metrics(self):
        package = {
            'geography': {'id': 'pdx', 'query': 'Portland'},
            'records': [{'quality': {'total': 0.9}}], 'rejected': [],
            'duplicates': {}, 'coverage': {'gaps': []},
        }
        gate = evaluate_review_package_gate(package)
        self.assertTrue(gate['automatedReady'])

    def test_package_gate_uses_attached_source_metadata(self):
        package = {
            'geography': {'id': 'pdx', 'query': 'Portland'},
            'records': [{'quality': {'total': 0.9}}], 'rejected': [], 'duplicates': {},
            'coverage': {'gaps': []}, 'sourceMetadata': [{'licenseUrl': 'https://city.gov/license', 'authorityTier': 'city_government'}],
        }
        gate = evaluate_review_package_gate(package)
        self.assertTrue(gate['automatedReady'])

    def test_failed_coverage_blocks_even_if_human_toggle_is_present(self):
        gate = evaluate_region_gate(region_id="x", region_name="X",
                                    adapter_status="SUCCEEDED", accepted_count=2,
                                    coverage_gaps=["libraries"], human_advanced=True)
        self.assertFalse(gate["automatedReady"])
        self.assertFalse(gate["canAdvance"])
        self.assertIn("coverage", gate["blockers"])

    def test_all_gates_and_human_toggle_allow_advance(self):
        gate = evaluate_region_gate(region_id="x", region_name="X",
                                    adapter_status="SUCCEEDED", accepted_count=2,
                                    coverage_gaps=[], duplicate_count=0,
                                    validation_errors=[], human_advanced=True)
        self.assertTrue(gate["canAdvance"])


if __name__ == "__main__":
    unittest.main()
