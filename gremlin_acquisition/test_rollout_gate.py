import unittest

from gremlin_acquisition.rollout_gate import evaluate_region_gate


class RolloutGateTests(unittest.TestCase):
    def test_portland_needs_human_toggle_after_automated_pass(self):
        gate = evaluate_region_gate(region_id="replay-portland", region_name="Portland",
                                    adapter_status="SUCCEEDED", accepted_count=4,
                                    coverage_gaps=[], duplicate_count=0,
                                    validation_errors=[])
        self.assertTrue(gate["automatedReady"])
        self.assertFalse(gate["canAdvance"])
        self.assertEqual(gate["blockers"], ["human_readiness"])

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
