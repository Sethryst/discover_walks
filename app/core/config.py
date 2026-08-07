"""Typed application configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv


@dataclass(frozen=True, slots=True)
class RetrySettings:
    """Default retry behaviour for Gremlin network operations."""

    max_retries: int = 3
    backoff: str = "exponential"


@dataclass(frozen=True, slots=True)
class Settings:
    """Validated application settings; secrets remain in the environment."""

    database_url: str
    log_level: str = "INFO"
    default_timeout_seconds: int = 30
    default_rate_limit: float = 1.0
    retry: RetrySettings = field(default_factory=RetrySettings)

    @classmethod
    def from_environment(cls) -> "Settings":
        """Build settings from the configured environment without hardcoded secrets."""
        load_dotenv()
        database_url = os.getenv("DATABASE_URL") or _database_url_from_parts()
        if not database_url:
            raise ValueError("DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD are required.")
        return cls(
            database_url=database_url,
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
            default_timeout_seconds=int(os.getenv("GREMLIN_TIMEOUT_SECONDS", "30")),
            default_rate_limit=float(os.getenv("GREMLIN_RATE_LIMIT", "1")),
            retry=RetrySettings(
                max_retries=int(os.getenv("GREMLIN_MAX_RETRIES", "3")),
                backoff=os.getenv("GREMLIN_BACKOFF", "exponential"),
            ),
        )


def _database_url_from_parts() -> str | None:
    """Compose the legacy local configuration only when every part is present."""
    keys = ("DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT", "DB_NAME")
    values = {key: os.getenv(key) for key in keys}
    if not all(values.values()):
        return None
    return "postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}".format(**values)
