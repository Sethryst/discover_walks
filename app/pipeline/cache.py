"""Content-addressed local source cache, never copied into public bundles."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def cache_response(cache_root: Path, region_id: str, source_id: str, body: Any, acquired_at: str) -> Path:
    """Persist the untouched provider response and sidecar checksum for replayable builds."""
    destination = cache_root / region_id / source_id
    destination.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(body, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    data_path = destination / f"{acquired_at.replace(':', '-')}.json"
    data_path.write_bytes(payload)
    data_path.with_suffix(".sha256").write_text(f"sha256:{digest}\n", encoding="utf-8")
    return data_path


def load_cached_response(path: Path) -> Any:
    """Load a cached response only after its content checksum is verified."""
    payload = path.read_bytes()
    checksum_path = path.with_suffix(".sha256")
    if not checksum_path.exists():
        raise ValueError(f"Cached response has no checksum sidecar: {path}")
    expected = checksum_path.read_text(encoding="utf-8").strip()
    actual = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    if expected != actual:
        raise ValueError(f"Cached response checksum mismatch: {path}")
    return json.loads(payload)
