"""Governed lifecycle contract for autonomous data-collection workers."""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Generic, TypeVar

from sqlalchemy.orm import Session

from app.models.source import RawPayload, RunStatus, Source, SourceRun

RawRecord = TypeVar("RawRecord")
NormalizedRecord = TypeVar("NormalizedRecord")


class RetryableGremlinError(Exception):
    """A temporary external failure that may be retried safely."""


class FatalGremlinError(Exception):
    """An unrecoverable failure such as invalid configuration or persistence failure."""


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """A record-level validation failure retained in execution logs."""
    record: object
    message: str


class BaseGremlin(ABC, Generic[RawRecord, NormalizedRecord]):
    """Autonomous worker bounded by Lab-owned auditing, validation, and persistence rules."""

    def __init__(self, name: str, config: Mapping[str, Any], session: Session, http_client: Any, logger: logging.Logger | logging.LoggerAdapter[Any]) -> None:
        """Receive all runtime dependencies; no global connections or hidden state."""
        self.name = name
        self.config = dict(config)
        self.session = session
        self.http_client = http_client
        self.logger = logger
        self.source_run: SourceRun | None = None
        self._validation_issues: list[ValidationIssue] = []

    def start(self) -> SourceRun:
        """Create and flush the governed execution record before any collection occurs."""
        source = self.session.query(Source).filter_by(name=self.name).one_or_none()
        if source is None:
            raise FatalGremlinError(f"No registered source named '{self.name}'.")
        run = SourceRun(source=source, status=RunStatus.RUNNING, started_at=datetime.now(timezone.utc))
        self.session.add(run)
        self.session.flush()
        self.source_run = run
        self._log(logging.INFO, "Gremlin execution started")
        return run

    @abstractmethod
    def scrape(self) -> Sequence[RawRecord]:
        """Collect records from the external source; raise retryable errors when appropriate."""

    @abstractmethod
    def transform(self, raw_records: Sequence[RawRecord]) -> Sequence[NormalizedRecord]:
        """Normalize raw input into this Gremlin's canonical record shape."""

    @abstractmethod
    def validate_record(self, record: NormalizedRecord) -> str | None:
        """Return a human-readable validation error, or ``None`` for valid records."""

    @abstractmethod
    def save(self, records: Sequence[NormalizedRecord]) -> None:
        """Persist validated normalized records inside the active Lab session."""

    def validate(self, records: Sequence[NormalizedRecord]) -> tuple[list[NormalizedRecord], list[ValidationIssue]]:
        """Separate invalid records without halting a whole run."""
        valid: list[NormalizedRecord] = []
        issues: list[ValidationIssue] = []
        for record in records:
            message = self.validate_record(record)
            if message:
                issues.append(ValidationIssue(record, message))
                self._log(logging.WARNING, "Record validation failed", error_type="validation", error_message=message)
            else:
                valid.append(record)
        self._validation_issues = issues
        return valid, issues

    def finish(self, status: RunStatus, error_message: str | None = None) -> None:
        """Close the source run with final metrics and status."""
        if self.source_run is None:
            return
        self.source_run.status = status
        self.source_run.completed_at = datetime.now(timezone.utc)
        self.source_run.error_message = error_message
        self._log(logging.INFO if status != RunStatus.FAILED else logging.ERROR, "Gremlin execution finished", error_type=None)

    def execute(self) -> SourceRun:
        """Run the lifecycle with retry, immutable raw capture, validation, and accountability."""
        try:
            run = self.start()
            raw_records = self._scrape_with_retry()
            run.records_found = len(raw_records)
            self._store_raw_payloads(raw_records)
            normalized = self.transform(raw_records)
            valid, issues = self.validate(normalized)
            run.records_validated = len(valid)
            run.records_failed = len(issues)
            self.save(valid)
            self.finish(RunStatus.PARTIAL if issues else RunStatus.SUCCESS)
            self.session.commit()
            return run
        except Exception as exc:
            self.session.rollback()
            if self.source_run is not None:
                self.source_run = self.session.merge(self.source_run)
                self.finish(RunStatus.FAILED, str(exc))
                self.session.commit()
            self._log(logging.ERROR, "Gremlin execution failed", error_type=type(exc).__name__, exc_info=True)
            raise

    def _scrape_with_retry(self) -> Sequence[RawRecord]:
        retries = int(self.config.get("retry_policy", {}).get("max_retries", 3))
        backoff = self.config.get("retry_policy", {}).get("backoff", "exponential")
        for attempt in range(retries + 1):
            try:
                return self.scrape()
            except RetryableGremlinError:
                if attempt == retries:
                    raise
                delay = 2**attempt if backoff == "exponential" else 1
                self._log(logging.WARNING, "Retryable collection failure", error_type="retryable", attempt=attempt + 1)
                time.sleep(delay)
        raise AssertionError("Retry loop ended unexpectedly")

    def _store_raw_payloads(self, records: Sequence[RawRecord]) -> None:
        if self.source_run is None:
            raise FatalGremlinError("A source run is required before raw payload storage.")
        for record in records:
            if not isinstance(record, dict):
                raise FatalGremlinError("Raw records must be dictionaries to preserve JSON source payloads.")
            self.session.add(RawPayload(source_run=self.source_run, payload=record))

    def _log(self, level: int, message: str, **extra: Any) -> None:
        exc_info = extra.pop("exc_info", False)
        context = {"gremlin_name": self.name, "source_run_id": self.source_run.id if self.source_run else None, **extra}
        self.logger.log(level, message, extra=context, exc_info=exc_info)
