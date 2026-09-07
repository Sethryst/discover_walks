from pathlib import Path

from app.pipeline.osm_state_cli import split_state_values


SCRIPT = (Path(__file__).parents[1] / "scripts" / "run-osm-state-batch.ps1").read_text(encoding="utf-8")


def test_comma_and_space_separated_state_arguments():
    assert split_state_values(["MD,NC,FL,CA"]) == ["MD", "NC", "FL", "CA"]
    assert split_state_values(["MD", "NC", "FL", "CA"]) == ["MD", "NC", "FL", "CA"]
    assert "$_ -split ','" in SCRIPT
    assert "ValueFromRemainingArguments = $true" in SCRIPT
    assert "@($RemainingStates)" in SCRIPT


def test_batch_is_sequential_and_continues_after_roadway_failure():
    assert "foreach ($state in $requestedStates)" in SCRIPT
    assert "build-state $state" in SCRIPT
    assert "build-poi-state $state" in SCRIPT
    assert SCRIPT.index("build-state $state") < SCRIPT.index("build-poi-state $state")
    roadway_failure = SCRIPT.index('Write-Warning "$state failed.')
    poi_build = SCRIPT.index("build-poi-state $state")
    assert roadway_failure < poi_build
    assert "continue" not in SCRIPT[roadway_failure:poi_build]


def test_poi_failure_preserves_roadway_and_failed_inputs():
    assert "roadway output remains independently valid" in SCRIPT
    assert "if ($stateSucceeded)" in SCRIPT
    assert "cleanup-state" in SCRIPT
    assert "--keep-source" in SCRIPT


def test_upload_is_opt_in_and_runs_after_all_state_builds():
    assert "[switch] $PublishSupabase" in SCRIPT
    assert "if ($PublishSupabase)" in SCRIPT
    assert SCRIPT.index("if ($PublishSupabase)") > SCRIPT.index("foreach ($state in $requestedStates)")
    assert "publish-release" in SCRIPT
