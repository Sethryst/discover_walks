"""Lossless provider-neutral feature representation used between acquisition and domains."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class SourceReference:
    """Identity and acquisition facts for one approved source."""

    source_id: str
    source_name: str
    source_url: str
    raw_format: str
    acquired_at: str
    source_metadata: dict[str, Any]
    confidence: float


@dataclass(frozen=True, slots=True)
class IntermediateFeature:
    """Lossless canonical representation emitted by every provider."""

    source_id: str
    source_name: str
    source_url: str
    geometry: dict[str, Any]
    properties: dict[str, Any]
    acquisition_timestamp: str
    metadata: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        """Serialize safely for the raw-cache derived intermediate artifact."""
        return asdict(self)
