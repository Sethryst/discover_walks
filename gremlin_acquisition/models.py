from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any

class SourceStatus(str, Enum):
    INVESTIGATE="INVESTIGATE"; VALIDATING="VALIDATING"; READY_FOR_REVIEW="READY FOR REVIEW"; APPROVED="APPROVED"; PROMOTED="PROMOTED"; DEAD_SOURCE="DEAD SOURCE"; SOURCE_MIGRATED="SOURCE MIGRATED"; NO_CURRENT_EVENTS="NO CURRENT EVENTS"; MISSING_GEO="MISSING GEO"; ADAPTER_FAILED="ADAPTER FAILED"; DUPLICATE_SOURCE="DUPLICATE SOURCE"; STALE_SOURCE="STALE SOURCE"

@dataclass(frozen=True)
class Geography:
    id: str; name: str; level: str; country: str="US"; parent_id: str|None=None; latitude: float|None=None; longitude: float|None=None

@dataclass
class EventEvidence:
    title: str; start: str; official_url: str; source_url: str; stable_id: str|None=None
    end: str|None=None; organization: str|None=None; venue: str|None=None; latitude: float|None=None; longitude: float|None=None
    free_entry_evidence: str|None=None; accessibility_evidence: str|None=None; parser: str|None=None
    retrieved_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    warnings: list[str] = field(default_factory=list); expired: bool = False
    timezone_name: str|None = None; raw_evidence_sha256: str|None = None

@dataclass
class ScoreBreakdown:
    geographic_novelty: float; publisher_novelty: float; expected_event_yield: float; freshness_likelihood: float
    authority: float; adapter_confidence: float; fallback_success: float; duplicate_risk: float
    recent_failure_penalty: float; empty_calendar_penalty: float; loop_penalty: float
    explanation: str
    @property
    def priority(self):
        return sum((self.geographic_novelty,self.publisher_novelty,self.expected_event_yield,self.freshness_likelihood,self.authority,self.adapter_confidence,self.fallback_success)) - sum((self.duplicate_risk,self.recent_failure_penalty,self.empty_calendar_penalty,self.loop_penalty))

@dataclass
class AcquisitionPlan:
    run_id: str; geography: Geography; search_lines: list[str]; novelty_target: str; budget: int; score: ScoreBreakdown
    reason: str

@dataclass
class SourceRecord:
    source_url: str; canonical_domain: str; geography_id: str; organization: str|None = None
    status: SourceStatus = SourceStatus.INVESTIGATE; events: list[EventEvidence] = field(default_factory=list)
    replacement_url: str|None = None; last_attempt: str|None = None; retry_cooldown: str|None = None
    failures: list[str] = field(default_factory=list); related_sources: list[str] = field(default_factory=list); code_version: str = "acquisition-v1"
    publisher_id: str|None = None; evidence_hash: str|None = None; approved_by: str|None = None

def jsonable(value: Any):
    if hasattr(value, "__dataclass_fields__"):
        return {k: jsonable(v) for k,v in asdict(value).items()}
    if isinstance(value, Enum): return value.value
    if isinstance(value, list): return [jsonable(v) for v in value]
    if isinstance(value, dict): return {k:jsonable(v) for k,v in value.items()}
    return value
