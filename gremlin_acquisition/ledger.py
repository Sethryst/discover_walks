from __future__ import annotations
import json, sqlite3, hashlib
from dataclasses import asdict
from pathlib import Path
from .models import SourceRecord, SourceStatus, jsonable

class AcquisitionLedger:
    """Durable, restart-safe ledger. JSON export is retained for inspection only."""
    def __init__(self, path=None):
        self.sources: dict[str,SourceRecord]={}; self.attempts=[]; self.decisions=[]; self.path=Path(path) if path else None
        self._db=sqlite3.connect(self.path) if self.path else None
        if self._db:
            self._db.executescript('''create table if not exists sources(url text primary key, payload text not null, updated_at text default current_timestamp);
            create table if not exists attempts(id integer primary key, payload text not null);
            create table if not exists decisions(id integer primary key, payload text not null);
            create table if not exists transitions(id integer primary key, payload text not null);'''); self._db.commit()
            for row in self._db.execute('select payload from sources'):
                data=json.loads(row[0]); data['status']=SourceStatus(data['status']); self.sources[data['source_url']]=SourceRecord(**data)
            self.attempts=[json.loads(row[0]) for row in self._db.execute('select payload from attempts order by id')]
            self.decisions=[json.loads(row[0]) for row in self._db.execute('select payload from decisions order by id')]
            self.transitions=[json.loads(row[0]) for row in self._db.execute('select payload from transitions order by id')]
        else: self.transitions=[]
    def record_attempt(self, run_id, geography_id, source_url, method, result, failure_reason=None, evidence_url=None, produced_events=False):
        payload={"run_id":run_id,"geography_id":geography_id,"source_url":source_url,"method":method,"result":result,"failure_reason":failure_reason,"evidence_url":evidence_url,"produced_events":produced_events}
        self.attempts.append(payload)
        if self._db: self._db.execute('insert into attempts(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()
    def upsert(self, source: SourceRecord):
        self.sources[source.source_url] = source
        if self._db: self._db.execute('insert or replace into sources(url,payload) values(?,?)',(source.source_url,json.dumps(jsonable(source),sort_keys=True))); self._db.commit()
    def record_decision(self, run_id, geography_id, score, reason):
        payload={"run_id":run_id,"geography_id":geography_id,"score":jsonable(score),"reason":reason}; self.decisions.append(payload)
        if self._db: self._db.execute('insert into decisions(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()

    def budget_available(self, limit): return len(self.attempts) < limit

    def transition(self, source, new_status, reason, actor='system'):
        """Apply an explicit lifecycle transition and retain an immutable history row."""
        from .models import SourceStatus
        old=source.status; new=SourceStatus(new_status)
        allowed={
            SourceStatus.INVESTIGATE:{SourceStatus.VALIDATING,SourceStatus.DEAD_SOURCE,SourceStatus.NO_CURRENT_EVENTS,SourceStatus.SOURCE_MIGRATED},
            SourceStatus.VALIDATING:{SourceStatus.READY_FOR_REVIEW,SourceStatus.MISSING_GEO,SourceStatus.ADAPTER_FAILED,SourceStatus.STALE_SOURCE},
            SourceStatus.READY_FOR_REVIEW:{SourceStatus.APPROVED,SourceStatus.STALE_SOURCE},
            SourceStatus.APPROVED:{SourceStatus.PROMOTED,SourceStatus.STALE_SOURCE},
            SourceStatus.PROMOTED:set(), SourceStatus.DEAD_SOURCE:{SourceStatus.SOURCE_MIGRATED,SourceStatus.INVESTIGATE},
            SourceStatus.SOURCE_MIGRATED:{SourceStatus.VALIDATING}, SourceStatus.NO_CURRENT_EVENTS:{SourceStatus.INVESTIGATE,SourceStatus.VALIDATING},
            SourceStatus.MISSING_GEO:{SourceStatus.VALIDATING}, SourceStatus.ADAPTER_FAILED:{SourceStatus.INVESTIGATE,SourceStatus.VALIDATING},
            SourceStatus.DUPLICATE_SOURCE:{SourceStatus.INVESTIGATE}, SourceStatus.STALE_SOURCE:{SourceStatus.INVESTIGATE,SourceStatus.VALIDATING}}
        if new != old and new not in allowed.get(old,set()): raise ValueError(f'illegal source transition: {old.value} -> {new.value}')
        source.status=new; row={'source_url':source.source_url,'from':old.value,'to':new.value,'reason':reason,'actor':actor}
        self.transitions.append(row)
        if self._db: self._db.execute('insert into transitions(payload) values(?)',(json.dumps(row,sort_keys=True),)); self._db.commit()
        return source
    def dump(self, path: str|Path):
        Path(path).write_text(json.dumps({"sources":jsonable(list(self.sources.values())),"attempts":self.attempts,"decisions":self.decisions}, indent=2, sort_keys=True), encoding="utf-8")

    def manifest(self, run_id, inputs, config, dependency_revision="unknown"):
        return {"run_id":run_id,"schema":"acquisition-ledger.v2","input_sha256":hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest(),"config":config,"dependency_revision":dependency_revision}
