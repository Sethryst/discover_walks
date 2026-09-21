"""Governed staged acceptance policy for Scout candidates.

Staging is intentionally more flexible than activation: it permits a reviewed
candidate to enter a research queue and receive fixtures, while production
activation still requires every lifecycle gate and release evidence.
"""
from __future__ import annotations

from typing import Any


STAGES = ("APPROVED", "RESEARCH_READY", "ACTIVATION_READY", "LANDED")


def assess_candidate(candidate: dict[str, Any], *, endpoint_verified: bool = False,
                     terms_verified: bool = False, fixture_saved: bool = False,
                     mapping_verified: bool = False, stable_id_verified: bool = False,
                     coordinates_verified: bool = False, refresh_verified: bool = False,
                     focused_tests_pass: bool = False, active_region_config: bool = False,
                     release_evidence: bool = False) -> dict[str, Any]:
    """Return the highest defensible stage and the next missing gates."""
    gates = {
        "endpointVerification": endpoint_verified,
        "termsLicense": terms_verified,
        "fixture": fixture_saved,
        "mapping": mapping_verified,
        "stableId": stable_id_verified,
        "coordinates": coordinates_verified,
        "refreshPolicy": refresh_verified,
        "focusedTests": focused_tests_pass,
    }
    missing = [name for name, passed in gates.items() if not passed]
    research_ready = endpoint_verified and terms_verified
    activation_ready = research_ready and not missing and active_region_config
    landed = activation_ready and release_evidence
    stage = "LANDED" if landed else "ACTIVATION_READY" if activation_ready else "RESEARCH_READY" if research_ready else "APPROVED"
    return {
        "candidateId": candidate["candidateId"], "stage": stage,
        "missingGates": missing,
        "activeRegionConfig": active_region_config,
        "releaseEvidence": release_evidence,
        "policy": "Staged acceptance authorizes research only; LANDED requires active region config plus generated release evidence.",
    }

