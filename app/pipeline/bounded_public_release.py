"""Build the fixture-backed bounded public-events release; never production config."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
from app.pipeline.adapters.nyc_socrata_events import NycSocrataEventsProvider
from app.pipeline.adapters.dc_rss_events import DcRssEventsProvider
from app.pipeline.contracts import validate_release
from app.pipeline.source_config import SourceConfig


def build(workspace: Path, output: Path) -> dict:
    fixture = workspace / "tests" / "fixtures"
    nyc = SourceConfig.from_dict({"id":"nyc-parks-14-day","name":"NYC Parks 14-day events (bounded)","provider":"nyc_socrata_events","url":"https://data.cityofnewyork.us/resource/w3wp-dpdi.json","domains":["event"],"licenseUrl":"https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje","providerOptions":{"defaultCoordinates":[-73.9857,40.7484]}})
    dc = SourceConfig.from_dict({"id":"dc-citywide-rss","name":"DC citywide RSS (bounded)","provider":"dc_rss_events","url":"https://calendar.dc.gov/node/all/events","domains":["event"],"licenseUrl":"https://oca.dc.gov/page/agency-data-terms-use","providerOptions":{"defaultCoordinates":[-77.0365,38.9072]}})
    import unittest.mock as mock
    from app.pipeline.adapters.nyc_socrata_events import urlopen as nyc_open
    from app.pipeline.adapters.dc_rss_events import urlopen as dc_open
    class R:
        def __init__(self,b,h): self.b,self.headers=b,h
        def __enter__(self): return self
        def __exit__(self,*a): pass
        def read(self): return self.b
    with mock.patch("app.pipeline.adapters.nyc_socrata_events.urlopen", return_value=R((fixture/"nyc_parks_upcoming_sample.json").read_bytes(), {"Last-Modified":"2026-09-30T00:00:00Z"})):
        nf, nr = NycSocrataEventsProvider().acquire(nyc,{})
    with mock.patch("app.pipeline.adapters.dc_rss_events.urlopen", return_value=R((fixture/"dc_citywide_events_sample.xml").read_bytes(), {"Cache-Control":"public, max-age=1800"})):
        df, dr = DcRssEventsProvider().acquire(dc,{})
    unique = {x.source_id:x for x in [*nf,*df]}
    pois=[{"id":x.source_id,"name":x.properties["name"],"lat":x.geometry["coordinates"][1],"lng":x.geometry["coordinates"][0],**x.properties,"category":"event","sourceId":x.metadata["sourceMetadata"]["sourceConfigId"]} for x in unique.values()]
    release={"schemaVersion":1,"regionId":"bounded-public-events","generatedAt":"2026-09-30T00:00:00Z","producer":{"name":"bounded-public-events","version":"development"},"pois":pois,"restrictions":{"nyc":"reference-only; source-local wall time; not publishable","dc":"offset-required; minimum poll interval 1800 seconds"},"sourceReports":{"nyc":nr,"dc":dr}}
    validate_release(release)
    output.mkdir(parents=True, exist_ok=True); (output/"events.json").write_text(json.dumps(release, indent=2)+"\n",encoding="utf-8")
    return release


if __name__ == "__main__":
    result=build(Path("."), Path("releases/bounded-public-events")); print(f"Built {len(result['pois'])} bounded events")
