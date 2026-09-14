from app.pipeline.furnish import _discover_artifact


def test_discover_contains_only_presentable_authored_journeys() -> None:
    pois = [{"id": "park:1", "name": "River Park"}]
    journeys = {"journeys": [
        {"id": "good", "name": "River Walk", "description": "Follow the river trail to a quiet overlook.", "chapters": [{"stops": [{"id": "park:1"}]}]},
        {"id": "jargon", "name": "Trail Journey", "description": "Built from official non-county trail geometry.", "chapters": [{"stops": [{"id": "park:1"}]}]},
        {"id": "empty", "name": "No stops", "description": "A locally authored walk.", "chapters": []},
    ]}

    artifact = _discover_artifact("test", "now", pois, journeys)

    assert [card["id"] for card in artifact["cards"]] == ["journey:good"]
    assert artifact["cards"][0]["reason"] == "Follow the river trail to a quiet overlook."
