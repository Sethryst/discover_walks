from __future__ import annotations
import hashlib, json
from datetime import datetime, timezone
from .models import SourceStatus, jsonable
class PromotionBuilder:
    def build(self, sources, selected_event_ids):
        chosen=[]; seen=set(); rejected=[]
        for source in sources:
            if source.status != SourceStatus.APPROVED: rejected.append(f"source not approved: {source.source_url}"); continue
            for event in source.events:
                eid=event.stable_id or hashlib.sha256(event.official_url.encode()).hexdigest()[:16]
                if eid in selected_event_ids:
                    if event.expired or event.warnings: rejected.append(f"invalid selected event: {eid}")
                    elif eid in seen: rejected.append(f"duplicate selected event: {eid}")
                    else: chosen.append(event); seen.add(eid)
        if rejected: raise ValueError('; '.join(rejected))
        payload={"schema":"gremlin.app-ready.v1","events":jsonable(chosen),"source_count":len(sources),"event_count":len(chosen)}
        payload["package_id"]=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()[:20]
        return payload
    def write(self,payload,path):
        import pathlib; pathlib.Path(path).write_text(json.dumps(payload,indent=2,sort_keys=True),encoding="utf-8")

class PromotionAudit:
    """Append-only local audit for package build, publish, and rollback actions."""
    def __init__(self, path):
        self.path = __import__('pathlib').Path(path)

    def record(self, action, package_id, actor, details=None):
        row = {'at': datetime.now(timezone.utc).isoformat(), 'action': action, 'package_id': package_id, 'actor': actor, 'details': details or {}}
        with self.path.open('a', encoding='utf-8') as handle: handle.write(json.dumps(row, sort_keys=True) + '\n')
        return row

    def publish(self, payload, actor, output):
        if not payload.get('package_id') or payload.get('event_count', 0) < 1: raise ValueError('cannot publish an empty or unaddressed package')
        self.record('publish', payload['package_id'], actor, {'output': str(output)})
        PromotionBuilder().write(payload, output)
        return payload['package_id']

    def rollback(self, package_id, actor, previous_package_id=None):
        if not package_id: raise ValueError('exact promotion package_id is required')
        return self.record('rollback', package_id, actor, {'restore_package_id': previous_package_id})
