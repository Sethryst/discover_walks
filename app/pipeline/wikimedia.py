"""Conservative Wikidata enrichment for explicitly linked OSM features."""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.pipeline.cache import cache_response

WIKIDATA_API = "https://www.wikidata.org/w/api.php"


class WikimediaEnricher:
    """Adds historical context only for source-provided Wikidata/Wikipedia identifiers."""

    def enrich(self, records: Iterable[dict[str, Any]], cache_root: Path, region_id: str, acquired_at: str) -> list[dict[str, str]]:
        """Attach concise sourced context; errors become structured warnings, never failures."""
        warnings: list[dict[str, str]] = []
        linked: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            source = record["sources"][0]
            properties = source.get("rawProperties", {})
            try:
                entity_id = self._entity_id(properties)
            except Exception as exc:
                warnings.append({"code": "wikimedia_enrichment_unavailable", "source": "wikidata", "detail": str(exc)})
                continue
            if not entity_id:
                continue
            linked.setdefault(entity_id, []).append(record)
        for ids in _chunks(list(linked), 50):
            try:
                raw = self._request({"action": "wbgetentities", "ids": "|".join(ids), "props": "claims|labels|descriptions", "languages": "en", "format": "json"})
                for entity_id in ids:
                    entity = raw.get("entities", {}).get(entity_id)
                    if not entity:
                        continue
                    cache_response(cache_root, region_id, f"wikidata-{entity_id}", {"entities": {entity_id: entity}}, acquired_at)
                    context = _context(entity, entity_id)
                    if context:
                        for record in linked[entity_id]:
                            record["properties"]["historicalContext"] = context
            except Exception as exc:
                warnings.append({"code": "wikimedia_enrichment_unavailable", "source": "wikidata", "detail": str(exc)})
        return warnings

    def _entity_id(self, properties: dict[str, Any]) -> str | None:
        value = properties.get("wikidata")
        if isinstance(value, str) and value.startswith("Q") and value[1:].isdigit():
            return value
        wikipedia = properties.get("wikipedia")
        if isinstance(wikipedia, str) and wikipedia.startswith("en:"):
            payload = self._request({"action": "wbgetentities", "sites": "enwiki", "titles": wikipedia[3:], "props": "claims|labels|descriptions", "languages": "en", "format": "json"})
            return next((key for key in payload.get("entities", {}) if key.startswith("Q")), None)
        return None

    def _entity(self, entity_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        raw = self._request({"action": "wbgetentities", "ids": entity_id, "props": "claims|labels|descriptions", "languages": "en", "format": "json"})
        return raw["entities"][entity_id], raw

    def _request(self, params: dict[str, str]) -> dict[str, Any]:
        url = f"{WIKIDATA_API}?{urlencode(params)}"
        with urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/1.0 (build-time geographic data producer)"}), timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))


def _context(entity: dict[str, Any], entity_id: str) -> dict[str, Any] | None:
    """Project only a historical fact and citation, never a free-form biography."""
    claims = entity.get("claims", {})
    founded = _date_claim(claims.get("P571", []))
    designation = _entity_claim(claims.get("P1435", []))
    if not founded and not designation:
        return None
    context: dict[str, Any] = {"wikidataId": entity_id, "sourceUrl": f"https://www.wikidata.org/wiki/{entity_id}"}
    if founded:
        context["inception"] = founded
    if designation:
        context["heritageDesignationId"] = designation
    return context


def _date_claim(claims: list[dict[str, Any]]) -> str | None:
    try:
        return str(claims[0]["mainsnak"]["datavalue"]["value"]["time"])[1:11]
    except (IndexError, KeyError, TypeError):
        return None


def _entity_claim(claims: list[dict[str, Any]]) -> str | None:
    try:
        return str(claims[0]["mainsnak"]["datavalue"]["value"]["id"])
    except (IndexError, KeyError, TypeError):
        return None


def _chunks(values: list[str], size: int) -> Iterable[list[str]]:
    """Yield API-friendly groups of known Wikidata identifiers."""
    for index in range(0, len(values), size):
        yield values[index:index + size]
