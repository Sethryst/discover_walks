from __future__ import annotations
import json
from dataclasses import asdict
from pathlib import Path
from .models import SourceRecord, jsonable

class AcquisitionLedger:
    def __init__(self): self.sources: dict[str,SourceRecord]={}; self.attempts=[]; self.decisions=[]
    def record_attempt(self, run_id, geography_id, source_url, method, result, failure_reason=None, evidence_url=None, produced_events=False):
        self.attempts.append({"run_id":run_id,"geography_id":geography_id,"source_url":source_url,"method":method,"result":result,"failure_reason":failure_reason,"evidence_url":evidence_url,"produced_events":produced_events})
    def upsert(self, source: SourceRecord): self.sources[source.source_url] = source
    def record_decision(self, run_id, geography_id, score, reason): self.decisions.append({"run_id":run_id,"geography_id":geography_id,"score":jsonable(score),"reason":reason})
    def dump(self, path: str|Path):
        Path(path).write_text(json.dumps({"sources":jsonable(list(self.sources.values())),"attempts":self.attempts,"decisions":self.decisions}, indent=2, sort_keys=True), encoding="utf-8")
