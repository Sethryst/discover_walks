"""Source registry and immutable collection audit records."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SourceType(str, enum.Enum):
    """Supported kinds of external sources."""
    API = "api"
    CSV = "csv"
    WEB_SCRAPE = "web_scrape"
    DATABASE = "database"


class RunStatus(str, enum.Enum):
    """Lifecycle states for a source run."""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"


class Source(Base):
    """Immutable registry entry describing an external data source."""
    __tablename__ = "sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType, name="source_type"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    runs: Mapped[list["SourceRun"]] = relationship(back_populates="source")


class SourceRun(Base):
    """Accountable execution record for a Gremlin invocation."""
    __tablename__ = "source_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), nullable=False, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus, name="run_status"), nullable=False, default=RunStatus.PENDING)
    records_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_validated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    source: Mapped[Source] = relationship(back_populates="runs")
    raw_payloads: Mapped[list["RawPayload"]] = relationship(back_populates="source_run")


class RawPayload(Base):
    """Untouched input retained for reproducibility and later reprocessing."""
    __tablename__ = "raw_payloads"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_run_id: Mapped[int] = mapped_column(ForeignKey("source_runs.id"), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    source_run: Mapped[SourceRun] = relationship(back_populates="raw_payloads")
