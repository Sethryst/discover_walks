import json
from gremlin_acquisition.cli import main


def test_cli_builds_review_package_from_replay_source(tmp_path, capsys):
    region = tmp_path / "region.json"
    region.write_text(json.dumps({"id": "city-1", "name": "Example City", "sources": [{"provider": "geojson", "url": "https://city.gov/parks", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}}]}))
    body = tmp_path / "body.json"
    body.write_text(json.dumps({"features": [{"type": "Feature", "properties": {"id": "p1", "name": "Central Park"}, "geometry": {"type": "Point", "coordinates": [-122.6, 45.5]}}]}))
    output = tmp_path / "packages"
    assert main(["--ledger", str(tmp_path / "ledger.sqlite3"), "--region-config", str(region), "--source-body", str(body), "--output-dir", str(output)]) is None
    result = json.loads(capsys.readouterr().out)
    assert result["reviewPackageId"]
    assert len(list(output.glob("*.json"))) == 1
