"""Source adapter protocol."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any

from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class SourceAdapter(ABC):
    """A named acquisition boundary that returns source-native records."""

    @abstractmethod
    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[Sequence[IntermediateFeature], Any]:
        """Fetch and parse one approved source, returning features and untouched response."""
