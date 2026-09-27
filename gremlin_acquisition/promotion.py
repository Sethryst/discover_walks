from __future__ import annotations
import hashlib, json
from .models import SourceStatus, jsonable
class PromotionBuilder:
    def build(self, sources, selected_event_ids):
        chosen=[]; seen=set()
        for source in sources:
            if source.status != SourceStatus.APPROVED: continue
            for event in source.events:
                eid=event.stable_id or hashlib.sha256(event.official_url.encode()).hexdigest()[:16]
                if eid in selected_event_ids and eid not in seen and not event.expired and not event.warnings: chosen.append(event); seen.add(eid)
        payload={"schema":"gremlin.app-ready.v1","events":jsonable(chosen),"source_count":len(sources),"event_count":len(chosen)}
        payload["package_id"]=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()[:20]
        return payload
    def write(self,payload,path):
        import pathlib; pathlib.Path(path).write_text(json.dumps(payload,indent=2,sort_keys=True),encoding="utf-8")
