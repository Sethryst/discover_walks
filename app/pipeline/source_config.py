"""Validated configuration for approved regional sources."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from app.pipeline.osm_config import normalize_osm_config, osm_source_dict


@dataclass(frozen=True, slots=True)
class SourceConfig:
    """An allowlisted provider instance; credentials are referenced, never stored."""
    id: str
    name: str
    provider: str
    url: str
    domains: tuple[str, ...]
    license_url: str
    confidence: float = 0.9
    query_params: dict[str, str] = field(default_factory=dict)
    provider_options: dict[str, Any] = field(default_factory=dict)
    credential_env: str | None = None
    authority_tier: str = "community"
    layer_role: str | None = None
    property_mapping: dict[str, Any] = field(default_factory=dict)
    attribution: str | None = None
    artifact_name: str | None = None
    data_class: str = "durable"
    visible_value: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SourceConfig":
        """Validate and construct source configuration from region JSON."""
        required = ("id", "name", "provider", "url", "licenseUrl")
        missing = [key for key in required if key not in raw]
        if missing:
            raise ValueError(f"Source configuration missing: {', '.join(missing)}")
        domains = tuple(raw.get("domains", ()))
        layer_role = raw.get("layerRole")
        if not domains and not layer_role:
            raise ValueError(f"Source '{raw['id']}' requires domains or layerRole.")
        mapping = dict(raw.get("propertyMapping", {}))
        if layer_role and not {"id", "name"}.issubset(mapping):
            raise ValueError(f"Geographic source '{raw['id']}' requires propertyMapping.id and propertyMapping.name.")
        return cls(
            id=raw["id"],
            name=raw["name"],
            provider=raw["provider"],
            url=raw["url"],
            domains=domains,
            license_url=raw["licenseUrl"],
            confidence=float(raw.get("confidence", 0.9)),
            query_params=dict(raw.get("queryParams", {})),
            provider_options=dict(raw.get("providerOptions", {})),
            credential_env=raw.get("credentialEnv"),
            authority_tier=raw.get("authorityTier", "community"),
            layer_role=layer_role,
            property_mapping=mapping,
            attribution=raw.get("attribution"),
            artifact_name=raw.get("artifactName"),
            data_class=raw.get("dataClass", "durable"),
            visible_value=raw.get("visibleValue"),
        )

    def credential(self) -> str | None:
        """Resolve an optional token at execution time only."""
        load_dotenv()
        return os.getenv(self.credential_env) if self.credential_env else None


def load_region(path: Path) -> dict[str, Any]:
    """Load a region and its approved source allowlist."""
    region = json.loads(path.read_text(encoding="utf-8"))
    profile_sources: list[dict[str, Any]] = []
    if profile := region.get("profile"):
        profile_path = path.parent / "profiles" / f"{profile}.json"
        if not profile_path.exists():
            raise ValueError(f"Unknown region profile: {profile}")
        profile_sources = json.loads(profile_path.read_text(encoding="utf-8")).get("sources", [])
    osm = normalize_osm_config(region)
    region["osm"] = osm.as_public_dict()
    local_sources = _local_open_data_source(region, path)
    configured_sources = [*profile_sources, *region.get("sources", []), *local_sources]
    # Legacy per-category OSM sources are represented by the canonical region
    # block at runtime. Keeping both would duplicate queries and identities.
    configured_sources = [source for source in configured_sources if source.get("provider") != "osm_overpass"]
    if osm.enabled:
        configured_sources.append(osm_source_dict(osm))
    region["sources"] = [SourceConfig.from_dict(source) for source in configured_sources if source.get("status", "active") == "active"]
    return region


def _local_open_data_source(region: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    """Attach a same-named municipal capture folder as an explicit local source."""
    city = str(region.get("name", "")).split(",")[0].strip()
    aliases = {
        "New York City": "New York City",
        "Washington": "Washington",
        "Keystone & Summit County": "Keystone",
    }
    city = aliases.get(city, city)
    root = path.parents[2] / "OpenData"
    if not root.exists():
        return []
    matches = [folder for state in root.iterdir() if state.is_dir() for folder in state.iterdir() if folder.is_dir() and folder.name.casefold() == city.casefold()]
    if len(matches) != 1 or not any(matches[0].glob("*.geojson")):
        return []
    return [{"id": "local-open-data", "name": f"Local municipal OpenData capture — {city}", "provider": "local_open_data", "url": str(matches[0]), "domains": ["parks", "trails", "rest", "art", "history", "plant", "accessibility", "wildlife", "nature"], "licenseUrl": "local://OpenData", "authorityTier": "city_government", "confidence": 0.8, "status": "active"}]
