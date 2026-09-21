"""Shared contracts for offline national walking routing."""
from __future__ import annotations

from typing import Literal, TypedDict

Availability = Literal["map_available", "routing_available", "routing_unavailable", "build_failed"]


class RouteResult(TypedDict, total=False):
    # Runtime graph coordinates are [lon, lat]. UI geometry may be [lat, lon].
    geometry: list
    distanceMeters: float
    durationSeconds: float
    edgeIds: list
    featureIds: list
    provenance: dict
    warnings: list[str]
    graphVersion: str
    cellId: str


def cell_id(tile_z: int, tile_x: int, tile_y: int) -> str:
    """Return the canonical deterministic routing cell identifier."""
    if min(tile_z, tile_x, tile_y) < 0 or tile_x >= 2**tile_z or tile_y >= 2**tile_z:
        raise ValueError("Invalid Web Mercator tile")
    return f"z{tile_z}-{tile_x}-{tile_y}"


def availability(*, map_available: bool, graph_verified: bool, build_failed: bool = False) -> Availability:
    if build_failed:
        return "build_failed"
    if graph_verified:
        return "routing_available"
    if map_available:
        return "routing_unavailable"
    return "map_available"
