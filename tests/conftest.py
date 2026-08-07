"""Shared test doubles; tests do not require PostgreSQL or external APIs."""

from unittest.mock import MagicMock


def fake_session() -> MagicMock:
    """Return an isolated SQLAlchemy session double."""
    return MagicMock()


def fake_http_client() -> MagicMock:
    """Return an isolated HTTP-client double."""
    return MagicMock()
