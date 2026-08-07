"""OpenStreetMap Overpass acquisition adapter for public places."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter


class OverpassAdapter(SourceAdapter):
    """Acquire public OSM park, trail, and attraction features for a configured bbox."""

    name = "openstreetmap-overpass"
    url = "https://overpass-api.de/api/interpreter"

    def acquire(self, region: dict[str, Any]) -> Sequence[dict[str, Any]]:
        """Query Overpass and return its source-native elements without normalization."""
        south, west, north, east = region["bbox"]
        query = f"""[out:json][timeout:60];
        (nwr[\"leisure\"=\"park\"]({south},{west},{north},{east});
         nwr[\"tourism\"=\"attraction\"]({south},{west},{north},{east});
         nwr[\"highway\"=\"path\"]({south},{west},{north},{east}););
        out center tags;"""
        request = Request(self.url, data=query.encode("utf-8"), headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Gremlin-Lab/1.0"})
        try:
            with urlopen(request, timeout=75) as response:
                body = json.loads(response.read().decode("utf-8"))
        except OSError as exc:
            raise RetryableGremlinError(f"Overpass acquisition failed: {exc}") from exc
        return body.get("elements", [])
