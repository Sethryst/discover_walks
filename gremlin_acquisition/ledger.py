from __future__ import annotations
import json, sqlite3, hashlib
from dataclasses import asdict
from pathlib import Path
from .models import SourceRecord, SourceStatus, jsonable

class AcquisitionLedger:
    """Durable, restart-safe ledger. JSON export is retained for inspection only."""
    def __init__(self, path=None):
        self.sources: dict[str,SourceRecord]={}; self.attempts=[]; self.decisions=[]; self.coverage=[]; self.search_feedback=[]; self.region_discoveries=[]; self.pois=[]; self.review_packages=[]; self.path=Path(path) if path else None
        self._db=sqlite3.connect(self.path) if self.path else None
        if self._db:
            self._db.executescript('''create table if not exists sources(url text primary key, payload text not null, updated_at text default current_timestamp);
            create table if not exists attempts(id integer primary key, payload text not null);
            create table if not exists decisions(id integer primary key, payload text not null);
            create table if not exists transitions(id integer primary key, payload text not null);
            create table if not exists coverage(id integer primary key, payload text not null);
            create table if not exists search_feedback(id integer primary key, payload text not null);
            create table if not exists region_discoveries(id integer primary key, payload text not null);
            create table if not exists pois(id integer primary key, payload text not null);
            create table if not exists review_packages(package_id text primary key, payload text not null);'''); self._db.commit()
            for row in self._db.execute('select payload from sources'):
                data=json.loads(row[0]); data['status']=SourceStatus(data['status']); self.sources[data['source_url']]=SourceRecord(**data)
            self.attempts=[json.loads(row[0]) for row in self._db.execute('select payload from attempts order by id')]
            self.decisions=[json.loads(row[0]) for row in self._db.execute('select payload from decisions order by id')]
            self.transitions=[json.loads(row[0]) for row in self._db.execute('select payload from transitions order by id')]
            self.coverage=[json.loads(row[0]) for row in self._db.execute('select payload from coverage order by id')]
            self.search_feedback=[json.loads(row[0]) for row in self._db.execute('select payload from search_feedback order by id')]
            self.region_discoveries=[json.loads(row[0]) for row in self._db.execute('select payload from region_discoveries order by id')]
            self.pois=[json.loads(row[0]) for row in self._db.execute('select payload from pois order by id')]
            self.review_packages=[json.loads(row[0]) for row in self._db.execute('select payload from review_packages order by package_id')]
        else: self.transitions=[]
    def record_attempt(self, run_id, geography_id, source_url, method, result, failure_reason=None, evidence_url=None, produced_events=False):
        payload={"run_id":run_id,"geography_id":geography_id,"source_url":source_url,"method":method,"result":result,"failure_reason":failure_reason,"evidence_url":evidence_url,"produced_events":produced_events}
        self.attempts.append(payload)
        if self._db: self._db.execute('insert into attempts(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()
    def upsert(self, source: SourceRecord):
        self.sources[source.source_url] = source
        if self._db: self._db.execute('insert or replace into sources(url,payload) values(?,?)',(source.source_url,json.dumps(jsonable(source),sort_keys=True))); self._db.commit()
    def record_decision(self, run_id, geography_id, score, reason, requirement_categories=None):
        payload={"run_id":run_id,"geography_id":geography_id,"score":jsonable(score),"reason":reason,"requirement_categories":requirement_categories or []}; self.decisions.append(payload)
        if self._db: self._db.execute('insert into decisions(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()

    def record_coverage(self, run_id, report):
        payload={"run_id":run_id, **report}; self.coverage.append(payload)
        if self._db: self._db.execute('insert into coverage(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()

    def record_search_feedback(self, run_id, geography_id, query, outcome, categories_found=None, notes=None):
        payload={"run_id":run_id,"geography_id":geography_id,"query":query,"outcome":outcome,"categories_found":categories_found or [],"notes":notes}
        self.search_feedback.append(payload)
        if self._db: self._db.execute('insert into search_feedback(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()

    def record_region_discovery(self, run_id, discovery):
        payload={"run_id": run_id, "query": discovery.query, "status": discovery.status,
                 "geography": jsonable(discovery.geography), "reason": discovery.reason}
        self.region_discoveries.append(payload)
        if self._db: self._db.execute('insert into region_discoveries(payload) values(?)',(json.dumps(payload,sort_keys=True),)); self._db.commit()

    def ingest_pois(self, run_id, need, adapter_result):
        """Persist adapter output, deduplicate it, and record coverage/change evidence."""
        from .package_intelligence import coverage_report, deduplicate_pois, diff_pois
        incoming = list(adapter_result.records)
        prior = [row["record"] for row in self.pois if row.get("geography_id") == need.geography_id]
        unique, duplicates = deduplicate_pois(incoming)
        current_payload = [{"record": jsonable(record), "geography_id": need.geography_id, "run_id": run_id} for record in unique]
        self.pois.extend(current_payload)
        if self._db:
            self._db.executemany('insert into pois(payload) values(?)', ((json.dumps(row, sort_keys=True),) for row in current_payload))
            self._db.commit()
        current = [row["record"] for row in current_payload]
        # Rehydrate enough to make change detection explicit without relying on
        # the database's JSON representation for policy decisions.
        from .package_intelligence import POIRecord
        def restore(row): return POIRecord(**row)
        changes = diff_pois([restore(row) for row in prior], [restore(row) for row in current])
        report = coverage_report(need, unique)
        report.update({"runId": run_id, "provider": adapter_result.provider, "sourceUrl": adapter_result.source_url,
                       "adapterStatus": adapter_result.status, "duplicateCount": sum(len(v) for v in duplicates.values()),
                       "changes": changes, "validationErrors": list(adapter_result.errors)})
        self.record_coverage(run_id, report)
        return report

    def ingest_fallback(self, run_id, need, fallback_result):
        """Persist all fallback attempts, then ingest only the selected result."""
        for attempt in fallback_result.attempts:
            self.record_attempt(run_id, need.geography_id, attempt.source_url, attempt.provider,
                                attempt.status.lower(), "; ".join(attempt.errors) or fallback_result.reason,
                                attempt.source_url, bool(attempt.records))
        if fallback_result.selected is None:
            self.record_search_feedback(run_id, need.geography_id, need.geography_query,
                                        fallback_result.status, notes=fallback_result.reason)
            return {"runId": run_id, "adapterStatus": fallback_result.status,
                    "attemptCount": len(fallback_result.attempts), "reason": fallback_result.reason}
        report = self.ingest_pois(run_id, need, fallback_result.selected)
        report.update({"attemptCount": len(fallback_result.attempts), "fallbackReason": fallback_result.reason})
        return report

    def record_review_package(self, payload):
        """Persist a deterministic package as review-only until explicitly approved."""
        row = {"package_id": payload["packageId"], "status": "READY FOR REVIEW",
               "payload": payload, "approval": None, "publication": None}
        existing = next((item for item in self.review_packages if item["package_id"] == row["package_id"]), None)
        if existing:
            return existing
        self.review_packages.append(row)
        coverage = payload.get("coverage")
        if coverage:
            self.coverage.append({"run_id": "review-package", "packageId": payload["packageId"], **coverage})
        if self._db:
            self._db.execute('insert into review_packages(package_id,payload) values(?,?)', (row["package_id"], json.dumps(row, sort_keys=True)))
            if coverage:
                self._db.execute('insert into coverage(payload) values(?)', (json.dumps(self.coverage[-1], sort_keys=True),))
            self._db.commit()
        return row

    def approve_review_package(self, package_id, actor, approval_reference):
        row = next((item for item in self.review_packages if item["package_id"] == package_id), None)
        if not row:
            raise KeyError(f"unknown review package: {package_id}")
        if row["status"] != "READY FOR REVIEW":
            raise ValueError(f"package is not awaiting review: {row['status']}")
        if not actor or not approval_reference:
            raise ValueError("trusted moderator actor and approval reference are required")
        row["status"] = "APPROVED"
        row["approval"] = {"actor": actor, "reference": approval_reference}
        if self._db:
            self._db.execute('update review_packages set payload=? where package_id=?', (json.dumps(row, sort_keys=True), package_id))
            self._db.commit()
        return row

    def mark_package_promoted(self, package_id, publication_reference):
        row = next((item for item in self.review_packages if item["package_id"] == package_id), None)
        if not row or row["status"] != "APPROVED":
            raise ValueError("only an approved package can be promoted")
        row["status"] = "PROMOTED"
        row["publication"] = {"reference": publication_reference}
        if self._db:
            self._db.execute('update review_packages set payload=? where package_id=?', (json.dumps(row, sort_keys=True), package_id))
            self._db.commit()
        return row

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
        Path(path).write_text(json.dumps({"sources":jsonable(list(self.sources.values())),"attempts":self.attempts,"decisions":self.decisions,"coverage":self.coverage,"search_feedback":self.search_feedback,"region_discoveries":self.region_discoveries,"pois":self.pois,"review_packages":self.review_packages}, indent=2, sort_keys=True), encoding="utf-8")

    def manifest(self, run_id, inputs, config, dependency_revision="unknown"):
        return {"run_id":run_id,"schema":"acquisition-ledger.v2","input_sha256":hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest(),"config":config,"dependency_revision":dependency_revision}
