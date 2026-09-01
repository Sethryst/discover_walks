"""Build walker-visible pack sidecars from an already validated regional release."""

from __future__ import annotations

import hashlib
import json
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from typing import Any


CAPABILITY_STATES = {"furnished", "empty-by-design", "stale", "none"}
CUISINE_CATEGORIES = {"coffee", "cafe", "market", "restaurant"}
REC_CATEGORIES = {"park", "nature", "wildlife", "trail", "history", "facility", "rest", "water"}
DISCOVER_KINDS = {
    "park": "park", "nature": "park", "wildlife": "wildlife", "coffee": "cafe",
    "cafe": "cafe", "market": "market", "restaurant": "restaurant", "art": "art",
    "history": "heritage", "community": "community", "facility": "facility",
    "rest": "comfort", "water": "water", "trail": "trail",
}


def furnish_region(region_id: str, output_root: Path, install_root: Path | None = None) -> dict[str, Any]:
    """Emit edges, Discover cards, Learn cards, and capability state without reacquisition."""
    bundle = output_root / region_id
    release = _object(bundle / "pois.json")
    manifest = _object(bundle / "producer-manifest.json")
    records = _array(bundle / "supplemental" / "canonical-records.json")
    journeys = _optional_object(bundle / "supplemental" / "journeys.json") or {"journeys": []}
    pois = release.get("pois", [])

    edges = _edge_artifact(region_id, release["generatedAt"], records)
    discover = _discover_artifact(region_id, release["generatedAt"], pois, journeys)
    learn = _learn_artifact(region_id, release["generatedAt"], pois, discover)
    news = _news_capability(bundle, manifest)
    capabilities = {
        "schemaVersion": 1,
        "regionId": region_id,
        "generatedAt": release["generatedAt"],
        "capabilities": {
            "news": news,
            "recreation": "furnished" if edges["edges"] or any(poi.get("category") in REC_CATEGORIES for poi in pois) else "empty-by-design",
            "cuisine": "furnished" if any(poi.get("category") in CUISINE_CATEGORIES for poi in pois) else "empty-by-design",
            "journeys": "furnished" if journeys.get("journeys") else "empty-by-design",
            "discover": "furnished" if discover["cards"] else "empty-by-design",
            "learn": "furnished" if learn["cards"] else "empty-by-design",
            "personal": "empty-by-design",
        },
    }
    artifacts = {
        "supplemental/edges.json": edges,
        "supplemental/discover.json": discover,
        "supplemental/learn.json": learn,
        "capabilities.json": capabilities,
    }
    for relative, payload in artifacts.items():
        path = bundle / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        content = _json_bytes(payload)
        path.write_bytes(content)
        manifest.setdefault("checksums", {})[relative] = _checksum(content)
    manifest["capabilities"] = capabilities["capabilities"]
    (bundle / "producer-manifest.json").write_bytes(_json_bytes(manifest))

    if install_root is not None:
        destination = install_root / region_id
        destination.mkdir(parents=True, exist_ok=True)
        ensure_installed_pin_contract(destination)
        install = {
            "edges.json": edges, "discover.json": discover, "learn.json": learn,
            "capabilities.json": capabilities, "journeys.json": journeys,
        }
        for name, payload in install.items():
            (destination / name).write_bytes(_json_bytes(payload))

    return {
        "regionId": region_id,
        "edges": len(edges["edges"]),
        "journeys": len(journeys.get("journeys", [])),
        "discoverCards": len(discover["cards"]),
        "learnCards": len(learn["cards"]),
        "capabilities": capabilities["capabilities"],
    }


def ensure_installed_pin_contract(destination: Path) -> int:
    """Normalize an installed pin package in place without replacing its governed records."""
    path = destination / "pois.json"
    payload = _object(path)
    pois = payload.get("pois", payload.get("pointsOfInterest", []))
    if not isinstance(pois, list):
        raise ValueError(f"Expected a pin array: {path}")
    for poi in pois:
        poi["artifact_type"] = "pin"
        if "geometry" in poi:
            raise ValueError(f"Installed POI contains edge geometry: {poi.get('id')}")
    path.write_bytes(_json_bytes(payload))
    return len(pois)


def _edge_artifact(region_id: str, generated_at: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    edges = []
    for record in records:
        geometry = record.get("geometry") or {}
        source_ids = {str(source.get("sourceId", "")) for source in record.get("sources", [])}
        if record.get("domain") != "trails" or geometry.get("type") not in {"LineString", "MultiLineString"}:
            continue
        if "sidewalk" in str(record.get("name", "")).casefold() or any("sidewalk" in source_id.casefold() for source_id in source_ids):
            continue
        sources = [_public_source(source) for source in record.get("sources", []) if source.get("sourceUrl")]
        edges.append({
            "id": record["id"], "name": record.get("name") or "Named trail", "artifact_type": "edge",
            "geometry": geometry,
            "surface": record.get("properties", {}).get("surface"),
            "officialUrl": sources[0]["url"] if sources else None,
            "source": sources,
        })
    return {"schemaVersion": 1, "regionId": region_id, "generatedAt": generated_at, "artifact_type": "edge", "edges": sorted(edges, key=lambda edge: edge["id"])}


def _discover_artifact(region_id: str, generated_at: str, pois: list[dict[str, Any]], journeys: dict[str, Any]) -> dict[str, Any]:
    cards: list[dict[str, Any]] = []
    for journey in journeys.get("journeys", []):
        stop_ids = list(dict.fromkeys(stop.get("id") for chapter in journey.get("chapters", []) for stop in [*chapter.get("stops", []), *chapter.get("amenities", [])] if stop.get("id")))
        cards.append({
            "id": f"journey:{journey['id']}", "artifact_type": "enrichment", "kind": "journey",
            "journeyId": journey["id"], "title": journey["name"],
            "reason": journey.get("description") or "A sourced sequence of named places and trail chapters.",
            "stopPlaceIds": stop_ids,
        })

    usable = [poi for poi in pois if poi.get("category") in DISCOVER_KINDS and isinstance(poi.get("lat"), (int, float)) and isinstance(poi.get("lng"), (int, float))]
    cells: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for poi in usable:
        cells.setdefault((int(poi["lat"] * 500), int(poi["lng"] * 500)), []).append(poi)
    seen: set[tuple[str, ...]] = set()
    anchors = sorted(usable, key=lambda poi: (DISCOVER_KINDS[poi["category"]] not in {"park", "heritage", "trail"}, poi["name"], poi["id"]))
    for anchor in anchors:
        key = (int(anchor["lat"] * 500), int(anchor["lng"] * 500))
        nearby = [candidate for row in range(key[0] - 2, key[0] + 3) for column in range(key[1] - 2, key[1] + 3) for candidate in cells.get((row, column), []) if candidate["id"] != anchor["id"] and _distance(anchor, candidate) <= 250]
        chosen = [anchor]
        kinds = {DISCOVER_KINDS[anchor["category"]]}
        for candidate in sorted(nearby, key=lambda poi: (_distance(anchor, poi), poi["id"])):
            kind = DISCOVER_KINDS[candidate["category"]]
            if kind in kinds:
                continue
            chosen.append(candidate)
            kinds.add(kind)
            if len(chosen) == 3:
                break
        if len(chosen) < 2:
            continue
        ids = tuple(sorted(poi["id"] for poi in chosen))
        if ids in seen:
            continue
        seen.add(ids)
        ordered_kinds = [DISCOVER_KINDS[poi["category"]] for poi in chosen]
        cards.append({
            "id": "cluster:" + hashlib.sha256("|".join(ids).encode()).hexdigest()[:16],
            "artifact_type": "enrichment", "kind": "+".join(ordered_kinds),
            "title": " + ".join(poi["name"] for poi in chosen),
            "reason": _cluster_reason(ordered_kinds),
            "stopPlaceIds": [poi["id"] for poi in chosen],
        })
        if len(cards) >= len(journeys.get("journeys", [])) + 24:
            break
    return {"schemaVersion": 1, "regionId": region_id, "generatedAt": generated_at, "artifact_type": "enrichment", "cards": cards}


def _learn_artifact(region_id: str, generated_at: str, pois: list[dict[str, Any]], discover: dict[str, Any]) -> dict[str, Any]:
    discover_ids = {place_id for card in discover["cards"] for place_id in card.get("stopPlaceIds", [])}
    cards = []
    candidates = sorted(pois, key=lambda poi: (not bool(poi.get("ebirdLocationId")), poi.get("category") != "wildlife", str(poi.get("name", "")), str(poi.get("id", ""))))
    for poi in candidates:
        if poi.get("id") not in discover_ids:
            continue
        url = f"https://ebird.org/hotspot/{poi['ebirdLocationId']}" if poi.get("ebirdLocationId") else _poi_url(poi)
        if not url:
            continue
        category = poi.get("category")
        question = {
            "wildlife": f"What birds make {poi['name']} a place to pause?",
            "park": f"What kind of ground does {poi['name']} protect?",
            "history": f"What happened around {poi['name']}?",
            "trail": f"Where does {poi['name']} carry a walker?",
        }.get(category, f"What is worth noticing at {poi['name']}?")
        source = next((source for source in poi.get("source", []) if isinstance(source, dict) and source.get("url")), {})
        cards.append({
            "id": f"learn:{poi['id']}", "artifact_type": "enrichment", "placeId": poi["id"],
            "question": question, "short": poi.get("description") or f"A sourced {str(category or 'place').replace('_', ' ')} in this installed pack.",
            "officialUrl": url, "provenance": {"name": source.get("name") or ("eBird" if poi.get("ebirdLocationId") else "Official source"), "url": url},
        })
        if len(cards) >= 24:
            break
    return {"schemaVersion": 1, "regionId": region_id, "generatedAt": generated_at, "artifact_type": "enrichment", "cards": cards}


def _cluster_reason(kinds: list[str]) -> str:
    labels = {"cafe": "cafe", "comfort": "fountain or comfort stop", "heritage": "heritage", "wildlife": "wildlife", "community": "library or community place"}
    words = [labels.get(kind, kind) for kind in kinds]
    if len(words) == 2:
        return f"A {words[0]} and {words[1]} are within a few minutes on foot."
    return f"A {words[0]}, {words[1]}, and {words[2]} sit within a short walk of one another."


def _poi_url(poi: dict[str, Any]) -> str | None:
    for key in ("officialUrl", "website", "link"):
        value = poi.get(key)
        if isinstance(value, str) and value.startswith("https://"):
            return value
    return next((source.get("url") for source in poi.get("source", []) if isinstance(source, dict) and str(source.get("url", "")).startswith("https://")), None)


def _news_capability(bundle: Path, manifest: dict[str, Any]) -> str:
    items = []
    for name in ("meetings", "events", "vote"):
        artifact = _optional_object(bundle / "civic" / f"{name}.json") or {}
        items.extend(artifact.get("items", []))
    civic_reports = [source for source in manifest.get("sources", []) if source.get("provider") == "civic_rss" or str(source.get("id", "")).endswith("-civic") or source.get("id") == "fairfax_civic"]
    if items:
        return "stale" if any(source.get("acquireStatus") != "success" for source in civic_reports) else "furnished"
    return "empty-by-design" if civic_reports and all(source.get("acquireStatus") == "success" for source in civic_reports) else "none"


def _public_source(source: dict[str, Any]) -> dict[str, Any]:
    return {"name": source.get("sourceName"), "url": source.get("sourceUrl"), "attribution": source.get("attribution"), "license": source.get("license")}


def _distance(left: dict[str, Any], right: dict[str, Any]) -> float:
    lat1, lng1, lat2, lng2 = map(radians, (left["lat"], left["lng"], right["lat"], right["lng"]))
    return 6_371_000 * 2 * asin(sqrt(sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2))


def _object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected object: {path}")
    return value


def _optional_object(path: Path) -> dict[str, Any] | None:
    return _object(path) if path.exists() else None


def _array(path: Path) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError(f"Expected array: {path}")
    return value


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _checksum(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()
