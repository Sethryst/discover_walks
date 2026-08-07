"""Structured, context-aware logging for governed Gremlin executions."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any


class JsonFormatter(logging.Formatter):
    """Render log records as compact JSON with optional Gremlin context."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialize the meaningful log fields and exception traceback."""
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("gremlin_name", "source_run_id", "error_type", "region_id", "records", "pois", "warnings", "destination", "fixture", "dry_run"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["traceback"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Configure the root handler once for structured operational logs."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


def get_logger(name: str, *, gremlin_name: str | None = None, source_run_id: int | None = None) -> logging.LoggerAdapter[Any]:
    """Return a logger carrying the execution context for every emitted record."""
    return logging.LoggerAdapter(logging.getLogger(name), {"gremlin_name": gremlin_name, "source_run_id": source_run_id})
