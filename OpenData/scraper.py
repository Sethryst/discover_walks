"""Reliable downloader for pedestrian-oriented US municipal open data.

The scraper intentionally favors a smaller number of complete, verified files over
large numbers of questionable downloads.  It uses only public HTTP APIs and never
overwrites an existing GeoJSON file.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import logging
import math
import os
import re
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import unquote, urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PORTALS = SCRIPT_DIR / "portals.csv"
DEFAULT_DATASETS = SCRIPT_DIR / "datasets.csv"
DEFAULT_DATASET_SELECTORS = SCRIPT_DIR / "dataset_selectors.csv"
DEFAULT_OUTPUT = SCRIPT_DIR
GEOMETRY_TYPES = {
    "location", "point", "multipoint", "line", "multiline",
    "polygon", "multipolygon",
}
ARCGIS_ITEM_TYPES = {"feature service", "feature layer", "map service"}
ID_4X4 = re.compile(r"^[a-z0-9]{4}-[a-z0-9]{4}$", re.I)
ARCGIS_ID = re.compile(r"^[a-f0-9]{32}$", re.I)

# Phrases are scored with word boundaries.  This avoids matching "park" inside
# "parking" and gives strong POI terms more weight than broad planning terms.
KEYWORD_WEIGHTS: tuple[tuple[str, int], ...] = (
    ("curb ramp", 5), ("ada ramp", 5), ("public art", 5),
    ("drinking fountain", 5), ("pedestrian", 5), ("sidewalk", 5),
    ("shared use path", 5), ("pedestrian bridge", 5),
    ("accessible entrance", 5), ("pedestrian signal", 5),
    ("trailhead", 5), ("trail", 4), ("greenway", 4), ("walkway", 4),
    ("crosswalk", 4), ("bench", 4), ("restroom", 4), ("toilet", 4),
    ("mural", 4), ("sculpture", 4), ("plaza", 4), ("garden", 4),
    ("open space", 4), ("promenade", 4), ("scenic overlook", 4),
    ("nature preserve", 4), ("natural area", 4), ("wildlife habitat", 4),
    ("birding", 4), ("water access", 4), ("historic landmark", 4),
    ("tree inventory", 4), ("street light inventory", 4),
    ("streetlight inventory", 4), ("light pole", 4),
    ("city boundary", 6), ("municipal boundary", 6),
    ("jurisdiction boundary", 6), ("neighborhood boundary", 5),
    ("shade structure", 4), ("picnic shelter", 4),
    ("wayfinding", 4), ("public stair", 4),
    ("park", 3), ("playground", 3), ("tree canopy", 3),
    ("street tree", 3), ("historic site", 3), ("bike rack", 3),
    ("bicycle parking", 3), ("path", 2), ("bikeway", 2),
)
NEGATIVE_PHRASES = (
    "budget", "expenditure", "payroll", "permit application", "survey response",
    "work order", "service request", "meeting minutes", "capital project",
    "traffic count", "crash", "collision", "crime", "arrest",
)
# These titles describe observations, operations, or administrative records—not
# place inventories. They are rejected even when their description has a valid
# geometry column. Keep this title-only so a useful park layer mentioning a
# maintenance programme in its description is not discarded.
EXCLUDED_TITLE_PATTERNS = (
    r"\bdeprecated\b",
    r"\bsidewalk\s+widths?\b",
    r"\b(?:ranger\s+)?reports?\b",
    r"\binspections?\b",
    r"\b(?:pedestrian|bicycle|bike|traffic)\s+counts?\b",
    r"\b(?:survey|evaluation|scores?|utilization|maintenance|standards?)\b",
    r"\bpermits?\b",
    r"\b(?:movies?|events?)\b",
    r"\b(?:crash|collision|incident|enforcement)\b",
    r"\bclosures?\b",
    r"\b(?:grant|capital|improvement)\s+projects?\b",
    r"\b(?:master|strategic|action)\s+plans?\b",
    r"\b(?:assessment|study|scoring surface)\b",
    r"\b(?:future|proposed|planned)\b",
    r"\b(?:easements?|taxlots?|land bank acquisitions?)\b",
    r"\b(?:management|maintenance)\s+zones?\b",
    r"\badministrative\s+applications?\b",
    r"\bapplications?\s+reviewed\b",
    r"\bstreet\s+lights?\s*[-:]?\s*(?:all|one)?\s*out\b",
    r"\bstreetlight\s+outage(?:s)?\b",
    r"\bstreetlight\s+(?:311|complaints?|service requests?)\b",
    r"\b(?:ask|public)\s+311\b",
    r"\bzoning\b",
    r"\bland\s+use\b",
    r"\bcouncil\s+district\b",
)
SEARCH_TERMS = (
    "park", "trail", "sidewalk", "pedestrian", "greenway", "tree canopy",
    "curb ramp", "bench", "drinking fountain", "restroom", "public art",
    "mural", "plaza", "garden", "crosswalk", "bike rack", "shared use path",
    "pedestrian bridge", "accessible entrance", "open space", "scenic overlook",
    "nature preserve", "wildlife habitat", "water access", "historic landmark",
    "tree inventory", "street light inventory", "streetlight inventory",
    "light pole", "lamp post", "shade structure", "picnic shelter", "wayfinding",
    "city boundary", "municipal boundary", "jurisdiction boundary", "neighborhood boundary",
)


class CrawlError(Exception):
    """A failure whose short message is suitable for the diagnostic CSV."""

    def __init__(self, reason: str, detail: str = "", status: int | None = None):
        super().__init__(detail or reason)
        self.reason = reason
        self.detail = detail
        self.status = status


@dataclass(frozen=True)
class Portal:
    state: str
    city: str
    url: str
    platform: str
    status: str = ""
    query_where: str = "1=1"
    bbox: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class Candidate:
    platform: str
    dataset_id: str
    title: str
    description: str
    source_url: str
    tags: tuple[str, ...] = ()
    raw: dict[str, Any] | None = None
    direct: bool = False


@dataclass
class Result:
    timestamp: str
    state: str
    city: str
    platform: str
    stage: str
    status: str
    dataset_id: str = ""
    dataset_name: str = ""
    source_url: str = ""
    file: str = ""
    feature_count: int | str = ""
    expected_count: int | str = ""
    invalid_feature_count: int | str = ""
    coverage_ratio: float | str = ""
    coverage_status: str = ""
    geometry_types: str = ""
    bbox_wgs84: str = ""
    coordinate_count: int | str = ""
    reason: str = ""
    http_status: int | str = ""
    detail: str = ""


@dataclass(frozen=True)
class DatasetRecord:
    state: str
    city: str
    platform: str
    dataset_id: str
    dataset_name: str
    source_url: str
    file: str
    status: str
    last_observed_feature_count: int | None = None
    last_checked: str = ""
    notes: str = ""
    query_where: str = "1=1"
    bbox: tuple[float, float, float, float] | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def plain_text(value: Any) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip()


def safe_component(value: str, fallback: str = "unknown") -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value.strip())
    value = value.rstrip(" .")
    return value or fallback


def slug(value: str, limit: int = 70) -> str:
    value = plain_text(value).lower()
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_")
    return (value[:limit].rstrip("_") or "dataset")


def parse_bbox(value: str) -> tuple[float, float, float, float] | None:
    """Parse ``south|west|north|east`` and reject invalid WGS84 extents."""
    value = value.strip()
    if not value:
        return None
    try:
        south, west, north, east = (float(part.strip()) for part in value.split("|"))
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"BBox_WGS84 must be south|west|north|east, got {value!r}"
        ) from exc
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise ValueError(f"BBox_WGS84 is outside WGS84 limits or inverted: {value!r}")
    return south, west, north, east


def format_bbox(bbox: tuple[float, float, float, float] | None) -> str:
    return "" if bbox is None else "|".join(f"{value:g}" for value in bbox)


def phrase_pattern(phrase: str) -> str:
    """Return a boundary-safe pattern that also accepts a normal plural."""
    words = phrase.split()
    last = words[-1]
    if last.endswith("y") and len(last) > 1 and last[-2] not in "aeiou":
        final = re.escape(last[:-1]) + "(?:y|ies)"
    elif last.endswith(("ch", "sh", "x", "z")):
        final = re.escape(last) + "(?:es)?"
    elif last.endswith("s"):
        final = re.escape(last)
    else:
        final = re.escape(last) + "s?"
    prefix = "\\s+".join(re.escape(word) for word in words[:-1])
    phrase_regex = f"{prefix}\\s+{final}" if prefix else final
    return rf"(?<![a-z0-9]){phrase_regex}(?![a-z0-9])"


def keyword_score(title: str, description: str = "", tags: Sequence[str] = ()) -> int:
    title_tags = " ".join((title, *tags)).lower()
    all_text = " ".join((title_tags, description)).lower()
    score = 0
    for phrase, weight in KEYWORD_WEIGHTS:
        pattern = phrase_pattern(phrase)
        if re.search(pattern, title_tags):
            score += weight * 2
        elif re.search(pattern, all_text):
            score += weight
    if any(phrase in all_text for phrase in NEGATIVE_PHRASES):
        score -= 4
    return score


def is_relevant(candidate: Candidate, minimum: int = 4) -> bool:
    title_tags = " ".join((candidate.title, *candidate.tags)).lower()
    if any(re.search(pattern, title_tags) for pattern in EXCLUDED_TITLE_PATTERNS):
        return False
    return keyword_score(candidate.title, candidate.description, candidate.tags) >= minimum


def spatial_summary(data: Any) -> dict[str, Any]:
    """Validate WGS84 coordinates and return compact GIS QA metadata."""
    features = data["features"]
    geometry_types: set[str] = set()
    coordinate_count = 0
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")

    def add_position(value: Any) -> None:
        nonlocal coordinate_count, min_lon, min_lat, max_lon, max_lat
        if (
            not isinstance(value, (list, tuple))
            or len(value) < 2
            or isinstance(value[0], bool)
            or isinstance(value[1], bool)
            or not isinstance(value[0], (int, float))
            or not isinstance(value[1], (int, float))
        ):
            raise ValueError("coordinate is not a numeric [longitude, latitude] position")
        lon, lat = float(value[0]), float(value[1])
        if not math.isfinite(lon) or not math.isfinite(lat):
            raise ValueError("coordinate contains a non-finite value")
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError(f"coordinate outside WGS84 bounds: [{lon}, {lat}]")
        coordinate_count += 1
        min_lon, max_lon = min(min_lon, lon), max(max_lon, lon)
        min_lat, max_lat = min(min_lat, lat), max(max_lat, lat)

    def walk_coordinates(value: Any) -> None:
        if isinstance(value, (list, tuple)) and value and isinstance(value[0], (int, float)):
            add_position(value)
            return
        if not isinstance(value, (list, tuple)):
            raise ValueError("geometry coordinates are not an array")
        for item in value:
            walk_coordinates(item)

    def walk_geometry(geometry: Any) -> None:
        if not isinstance(geometry, dict):
            raise ValueError("feature geometry is not an object")
        geometry_type = geometry.get("type")
        if geometry_type == "GeometryCollection":
            geometry_types.add(geometry_type)
            members = geometry.get("geometries")
            if not isinstance(members, list) or not members:
                raise ValueError("GeometryCollection has no geometries")
            for member in members:
                walk_geometry(member)
            return
        if geometry_type not in {
            "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon",
        }:
            raise ValueError(f"unsupported GeoJSON geometry type: {geometry_type!r}")
        geometry_types.add(geometry_type)
        walk_coordinates(geometry.get("coordinates"))

    for feature in features:
        walk_geometry(feature["geometry"])
    if coordinate_count == 0:
        raise ValueError("dataset has no coordinates")
    return {
        "geometry_types": "|".join(sorted(geometry_types)),
        "bbox_wgs84": ",".join(f"{value:.6f}" for value in (min_lon, min_lat, max_lon, max_lat)),
        "coordinate_count": coordinate_count,
    }


def valid_feature_collection(data: Any, require_features: bool = True) -> tuple[bool, str]:
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        return False, "response is not a GeoJSON FeatureCollection"
    features = data.get("features")
    if not isinstance(features, list):
        return False, "GeoJSON features member is not an array"
    if require_features and not features:
        return False, "dataset contains zero features"
    if features and not any(
        isinstance(feature, dict)
        and feature.get("type") == "Feature"
        and feature.get("geometry") is not None
        for feature in features
    ):
        return False, "all features have null or invalid geometry"
    try:
        spatial_summary(data)
    except (KeyError, TypeError, ValueError) as exc:
        return False, f"invalid WGS84 geometry: {exc}"
    return True, ""


def usable_features(data: Any) -> tuple[list[dict[str, Any]], int]:
    """Keep valid geometries while counting source records that need quarantine."""
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise CrawlError("invalid_geojson", "response is not a GeoJSON FeatureCollection")
    source_features = data.get("features")
    if not isinstance(source_features, list):
        raise CrawlError("invalid_geojson", "GeoJSON features member is not an array")
    valid_features: list[dict[str, Any]] = []
    invalid_count = 0
    for feature in source_features:
        valid, _ = valid_feature_collection(
            {"type": "FeatureCollection", "features": [feature]},
            require_features=True,
        )
        if valid:
            valid_features.append(feature)
        else:
            invalid_count += 1
    return valid_features, invalid_count


def coverage_quality(expected: int, observed: int, invalid: int = 0) -> dict[str, Any]:
    ratio = observed / expected if expected else 0.0
    return {
        "expected_count": expected,
        "invalid_feature_count": invalid,
        "coverage_ratio": round(ratio, 6),
        "coverage_status": "complete" if observed == expected and invalid == 0 else "incomplete",
    }


def dataset_key(state: str, city: str, platform: str, dataset_id: str) -> tuple[str, str, str, str]:
    return tuple(
        value.strip().casefold() for value in (state, city, platform, dataset_id)
    )


def load_datasets(path: Path) -> list[DatasetRecord]:
    if not path.exists():
        return []
    selectors = load_dataset_selectors(path.with_name("dataset_selectors.csv"))
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"State", "City", "Platform", "Dataset_ID", "File", "Status"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"datasets CSV is missing columns: {', '.join(sorted(missing))}")
        records: list[DatasetRecord] = []
        for row in reader:
            raw_count = (row.get("Last_Observed_Feature_Count") or "").strip()
            selector = selectors.get(dataset_key(
                row.get("State") or "", row.get("City") or "",
                row.get("Platform") or "", row.get("Dataset_ID") or "",
            ), {})
            records.append(DatasetRecord(
                state=(row.get("State") or "").strip(),
                city=(row.get("City") or "").strip(),
                platform=(row.get("Platform") or "").strip(),
                dataset_id=(row.get("Dataset_ID") or "").strip(),
                dataset_name=(row.get("Dataset_Name") or "").strip(),
                source_url=(row.get("Source_URL") or "").strip(),
                file=(row.get("File") or "").strip(),
                status=(row.get("Status") or "").strip(),
                last_observed_feature_count=int(raw_count) if raw_count.isdigit() else None,
                last_checked=(row.get("Last_Checked") or "").strip(),
                notes=(row.get("Notes") or "").strip(),
                query_where=selector.get("query_where", "1=1"),
                bbox=selector.get("bbox"),
            ))
    return records


def load_dataset_selectors(path: Path) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    """Load optional query selectors without changing the legacy dataset CSV schema."""
    if not path.exists():
        return {}
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"State", "City", "Platform", "Dataset_ID", "Query_Where", "BBox_WGS84"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"dataset selector CSV is missing columns: {', '.join(sorted(missing))}")
        return {
            dataset_key(
                row.get("State") or "", row.get("City") or "",
                row.get("Platform") or "", row.get("Dataset_ID") or "",
            ): {
                "query_where": (row.get("Query_Where") or "1=1").strip() or "1=1",
                "bbox": parse_bbox(row.get("BBox_WGS84") or ""),
            }
            for row in reader
        }


class HttpClient:
    def __init__(self, delay: float, timeout: float, logger: logging.Logger):
        self.delay = max(0.0, delay)
        self.timeout = timeout
        self.logger = logger
        self._last_request = 0.0
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "GremlinLabOpenDataScraper/1.0 (+public-data research)",
            "Accept": "application/json, application/geo+json;q=0.9, */*;q=0.2",
        })
        retry = Retry(
            total=3,
            connect=3,
            read=2,
            backoff_factor=0.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(("GET", "POST")),
            respect_retry_after_header=True,
        )
        self.session.mount("http://", HTTPAdapter(max_retries=retry))
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        wait = self.delay - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        request_values = dict(kwargs.get("params") or kwargs.get("data") or {})
        if "objectIds" in request_values:
            value = str(request_values["objectIds"])
            request_values["objectIds"] = f"<{value.count(',') + 1} IDs; {len(value)} chars>"
        self.logger.debug("HTTP %s %s values=%s", method, url, request_values or None)
        try:
            response = self.session.request(
                method, url, timeout=kwargs.pop("timeout", self.timeout), **kwargs
            )
        except requests.RequestException as exc:
            raise CrawlError("network_error", f"{type(exc).__name__}: {exc}") from exc
        finally:
            self._last_request = time.monotonic()
        return response

    def json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        method: str = "GET",
        expected: Sequence[int] = (200,),
        timeout: float | None = None,
    ) -> tuple[Any, requests.Response]:
        request_kwargs = {"data": params} if method.upper() == "POST" else {"params": params}
        if timeout is not None:
            request_kwargs["timeout"] = timeout
        response = self.request(method, url, **request_kwargs)
        if response.status_code not in expected:
            excerpt = plain_text(response.text[:300])
            raise CrawlError("http_error", excerpt, response.status_code)
        try:
            data = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            content_type = response.headers.get("content-type", "")
            raise CrawlError(
                "invalid_json", f"content-type={content_type}; body={response.text[:160]!r}",
                response.status_code,
            ) from exc
        if isinstance(data, dict) and data.get("error"):
            error = data["error"]
            raise CrawlError(
                "api_error", plain_text(error.get("message") or str(error)),
                error.get("code") if isinstance(error, dict) else response.status_code,
            )
        return data, response


class SocrataAdapter:
    name = "Socrata"

    def __init__(self, http: HttpClient, logger: logging.Logger, catalog_limit: int = 100):
        self.http = http
        self.logger = logger
        self.catalog_limit = catalog_limit
        # Discovery needs to be bounded. A failed catalog should not turn one
        # city into sixteen 40-second keyword timeouts.
        self.discovery_timeout = min(getattr(http, "timeout", 40.0), 12.0)

    @staticmethod
    def base_url(portal_url: str) -> str:
        parsed = urlparse(portal_url if "://" in portal_url else f"https://{portal_url}")
        return f"{parsed.scheme or 'https'}://{parsed.netloc}".rstrip("/")

    def discover(self, portal: Portal) -> list[Candidate]:
        base = self.base_url(portal.url)
        found: dict[str, Candidate] = {}
        catalog_worked = False
        for term in SEARCH_TERMS:
            try:
                data, _ = self.http.json(
                    f"{base}/api/catalog/v1",
                    params={
                        "q": term,
                        "only": "datasets",
                        "limit": self.catalog_limit,
                        "search_context": urlparse(base).netloc,
                    },
                    timeout=self.discovery_timeout,
                )
            except CrawlError as exc:
                self.logger.debug("Socrata catalog term %r failed: %s", term, exc)
                # The endpoint itself is unavailable. Fall back once; repeated
                # keyword queries against a dead/old host are both slow and rude.
                if not catalog_worked:
                    break
                continue
            catalog_worked = True
            for item in data.get("results", []) if isinstance(data, dict) else []:
                resource = item.get("resource") or {}
                dataset_id = str(resource.get("id") or "")
                if not ID_4X4.match(dataset_id):
                    continue
                candidate = Candidate(
                    platform=self.name,
                    dataset_id=dataset_id,
                    title=plain_text(resource.get("name")),
                    description=plain_text(resource.get("description")),
                    source_url=f"{base}/resource/{dataset_id}.geojson",
                    tags=tuple(str(tag) for tag in (resource.get("tags") or [])),
                    raw=item,
                )
                if is_relevant(candidate):
                    found[dataset_id] = candidate

        if found:
            return list(found.values())

        # views.json is a compatibility fallback.  It is queried only after the
        # catalog produces no useful records because some large portals return a
        # very large view list.
        try:
            data, _ = self.http.json(
                f"{base}/api/views.json", params={"limit": 5000},
                timeout=self.discovery_timeout,
            )
        except CrawlError:
            if catalog_worked:
                return []
            raise CrawlError(
                "catalog_unavailable",
                "both /api/catalog/v1 and /api/views.json failed or were invalid",
            )
        if not isinstance(data, list):
            raise CrawlError("invalid_catalog", "/api/views.json did not return a list")
        for item in data:
            dataset_id = str(item.get("id") or "")
            candidate = Candidate(
                platform=self.name,
                dataset_id=dataset_id,
                title=plain_text(item.get("name")),
                description=plain_text(item.get("description")),
                source_url=f"{base}/resource/{dataset_id}.geojson",
                tags=tuple(str(tag) for tag in (item.get("tags") or [])),
                raw=item,
            )
            if ID_4X4.match(dataset_id) and is_relevant(candidate):
                found[dataset_id] = candidate
        return list(found.values())

    def validate(self, portal: Portal, candidate: Candidate) -> dict[str, Any]:
        base = self.base_url(portal.url)
        metadata, _ = self.http.json(f"{base}/api/views/{candidate.dataset_id}.json")
        if str(metadata.get("id") or "") != candidate.dataset_id:
            raise CrawlError("ownership_mismatch", "metadata ID differs from catalog ID")
        columns = metadata.get("columns") or []
        geometry_columns = [
            column for column in columns
            if str(column.get("dataTypeName") or "").lower() in GEOMETRY_TYPES
        ]
        if not geometry_columns:
            raise CrawlError("not_geospatial", "metadata has no native geometry column")
        if str(metadata.get("viewType") or "").lower() not in ("", "tabular", "dataset"):
            raise CrawlError("not_dataset", f"viewType={metadata.get('viewType')!r}")
        return {"metadata": metadata, "geometry_columns": geometry_columns}

    def download(
        self,
        portal: Portal,
        candidate: Candidate,
        max_features: int,
        page_size: int,
    ) -> dict[str, Any]:
        base = self.base_url(portal.url)
        json_url = f"{base}/resource/{candidate.dataset_id}.json"
        count_data, _ = self.http.json(
            json_url, params={"$select": "count(*) as count"}
        )
        try:
            count = int(count_data[0]["count"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise CrawlError("count_failed", f"unexpected count response: {count_data!r}") from exc
        if count == 0:
            raise CrawlError("empty_dataset", "dataset count is zero")
        if count > max_features:
            raise CrawlError(
                "too_many_features", f"{count} exceeds --max-features={max_features}"
            )

        features: list[dict[str, Any]] = []
        invalid_count = 0
        geojson_url = f"{base}/resource/{candidate.dataset_id}.geojson"
        for offset in range(0, count, page_size):
            params = {
                "$limit": min(page_size, count - offset),
                "$offset": offset,
                "$order": ":id",
            }
            data, _ = self.http.json(geojson_url, params=params)
            page_features, page_invalid = usable_features(data)
            features.extend(page_features)
            invalid_count += page_invalid
        if not features:
            raise CrawlError("empty_geometry", f"all {count} source rows have invalid geometry")
        result = {"type": "FeatureCollection", "features": features}
        return {
            "geojson": result,
            "feature_count": len(features),
            "layer_id": "",
            "spatial": spatial_summary(result),
            "quality": coverage_quality(count, len(features), invalid_count),
        }


class ArcGISAdapter:
    name = "ArcGIS"

    def __init__(self, http: HttpClient, logger: logging.Logger, search_limit: int = 100):
        self.http = http
        self.logger = logger
        self.search_limit = search_limit
        self.discovery_timeout = min(getattr(http, "timeout", 40.0), 12.0)

    @staticmethod
    def base_url(portal_url: str) -> str:
        parsed = urlparse(portal_url if "://" in portal_url else f"https://{portal_url}")
        # ArcGIS Enterprise commonly lives below a web-adaptor path such as
        # /portal. Keep that path so sharing/rest discovery is addressed to the
        # organization's actual portal rather than the site root.
        return f"{parsed.scheme or 'https'}://{parsed.netloc}{parsed.path.rstrip('/')}".rstrip("/")

    def discover(self, portal: Portal) -> list[Candidate]:
        if re.search(r"/(?:FeatureServer|MapServer)(?:/\d+)?/?$", portal.url, re.I):
            digest = hashlib.sha1(portal.url.encode("utf-8")).hexdigest()[:16]
            exact_layer = bool(re.search(r"/(?:FeatureServer|MapServer)/\d+/?$", portal.url, re.I))
            service_path = [unquote(part) for part in urlparse(portal.url).path.split("/") if part]
            service_title = next(
                (service_path[index - 1] for index, part in enumerate(service_path)
                 if part.casefold() in {"featureserver", "mapserver"} and index),
                f"{portal.city} ArcGIS service",
            )
            metadata: dict[str, Any] | None = None
            if exact_layer:
                metadata, _ = self.http.json(portal.url.rstrip("/"), params={"f": "json"})
            return [Candidate(
                platform=self.name,
                dataset_id=digest,
                title=plain_text((metadata or {}).get("name")) or plain_text(service_title),
                description="Direct service URL from portals.csv",
                source_url=portal.url.rstrip("/"),
                raw=metadata,
                direct=exact_layer,
            )]

        try:
            hub_results = self._discover_hub(portal)
            if hub_results:
                return hub_results
        except CrawlError as exc:
            self.logger.debug("Hub discovery failed for %s: %s", portal.url, exc)

        return self._discover_portal_search(portal)

    def _discover_hub(self, portal: Portal) -> list[Candidate]:
        base = self.base_url(portal.url)
        found: dict[str, Candidate] = {}
        endpoint_base = f"{base}/api/search/v1/collections"
        endpoint_succeeded = False
        for collection in ("dataset", "appAndMap"):
            for term in SEARCH_TERMS:
                try:
                    data, _ = self.http.json(
                        f"{endpoint_base}/{collection}/items",
                        params={"q": term, "limit": self.search_limit},
                        timeout=self.discovery_timeout,
                    )
                except CrawlError as exc:
                    self.logger.debug("Hub collection %s failed: %s", collection, exc)
                    # A non-Hub ArcGIS Enterprise portal has no Hub Search API.
                    # Do not issue every keyword against a failed endpoint.
                    if not endpoint_succeeded:
                        raise CrawlError("hub_catalog_unavailable", "Hub Search API did not respond") from exc
                    break
                endpoint_succeeded = True
                for feature in data.get("features", []) if isinstance(data, dict) else []:
                    props = feature.get("properties") or {}
                    item_type = str(props.get("type") or "").lower()
                    item_id = str(feature.get("id") or props.get("id") or "").split("_")[0]
                    service_url = str(props.get("url") or "")
                    if (
                        item_type not in ARCGIS_ITEM_TYPES
                        or not ARCGIS_ID.match(item_id)
                        or not re.search(r"/(?:FeatureServer|MapServer)(?:/\d+)?/?$", service_url, re.I)
                    ):
                        continue
                    candidate = Candidate(
                        platform=self.name,
                        dataset_id=item_id,
                        title=plain_text(props.get("title")),
                        description=plain_text(props.get("description") or props.get("snippet")),
                        source_url=service_url.rstrip("/"),
                        tags=tuple(str(tag) for tag in (props.get("tags") or [])),
                        raw=props,
                    )
                    if is_relevant(candidate):
                        found[item_id] = candidate
        if not endpoint_succeeded:
            raise CrawlError("hub_catalog_unavailable", "Hub Search API did not respond")
        return list(found.values())

    def _discover_portal_search(self, portal: Portal) -> list[Candidate]:
        base = self.base_url(portal.url)
        portal_info, _ = self.http.json(f"{base}/sharing/rest/portals/self", params={"f": "json"})
        org_id = str(portal_info.get("id") or "")
        query_terms = " OR ".join(f'"{term}"' for term in SEARCH_TERMS)
        type_terms = 'type:"Feature Service" OR type:"Map Service"'
        query = f"({query_terms}) AND ({type_terms})"
        if org_id:
            query += f" AND orgid:{org_id}"
        found: dict[str, Candidate] = {}
        start = 1
        while start > 0 and len(found) < 500:
            data, _ = self.http.json(
                f"{base}/sharing/rest/search",
                params={"f": "json", "q": query, "num": 100, "start": start},
            )
            for item in data.get("results", []) if isinstance(data, dict) else []:
                item_id = str(item.get("id") or "")
                service_url = str(item.get("url") or "")
                if org_id and item.get("orgId") and item.get("orgId") != org_id:
                    continue
                candidate = Candidate(
                    platform=self.name,
                    dataset_id=item_id,
                    title=plain_text(item.get("title")),
                    description=plain_text(item.get("description") or item.get("snippet")),
                    source_url=service_url.rstrip("/"),
                    tags=tuple(str(tag) for tag in (item.get("tags") or [])),
                    raw=item,
                )
                if (
                    ARCGIS_ID.match(item_id)
                    and re.search(r"/(?:FeatureServer|MapServer)(?:/\d+)?/?$", service_url, re.I)
                    and is_relevant(candidate)
                ):
                    found[item_id] = candidate
            start = int(data.get("nextStart") or -1)
            if start < 1:
                break
        return list(found.values())

    def layers(self, candidate: Candidate) -> list[tuple[int, str, dict[str, Any]]]:
        service_url = candidate.source_url.rstrip("/")
        layer_match = re.search(r"/(?:FeatureServer|MapServer)/(\d+)$", service_url, re.I)
        if layer_match:
            metadata, _ = self.http.json(service_url, params={"f": "json"})
            return [(int(layer_match.group(1)), plain_text(metadata.get("name")), metadata)]
        service, _ = self.http.json(service_url, params={"f": "json"})
        layers: list[tuple[int, str, dict[str, Any]]] = []
        for layer in service.get("layers", []) if isinstance(service, dict) else []:
            layer_id = int(layer["id"])
            metadata, _ = self.http.json(f"{service_url}/{layer_id}", params={"f": "json"})
            layers.append((layer_id, plain_text(layer.get("name")), metadata))
        if not layers and service.get("geometryType"):
            layers.append((0, plain_text(service.get("name")), service))
        return layers

    def validate_layer(
        self,
        candidate: Candidate,
        layer_id: int,
        layer_name: str,
        metadata: dict[str, Any],
        layer_count: int,
    ) -> str:
        geometry_type = str(metadata.get("geometryType") or "")
        if not geometry_type:
            raise CrawlError("not_geospatial", "layer has no geometryType")
        capabilities = str(metadata.get("capabilities") or "")
        if "query" not in capabilities.lower():
            raise CrawlError("query_unsupported", f"capabilities={capabilities!r}")
        formats = str(metadata.get("supportedQueryFormats") or "")
        if "geojson" not in formats.lower():
            raise CrawlError("geojson_unsupported", f"supportedQueryFormats={formats!r}")
        # Ask the service to omit measures during download. Many ArcGIS layers
        # advertise M values but successfully return ordinary WGS84 GeoJSON when
        # `returnM=false`; rejecting them from metadata alone discarded usable
        # trail and pedestrian layers.
        layer_candidate = Candidate(
            platform=self.name,
            dataset_id=f"{candidate.dataset_id}_{layer_id}",
            title=layer_name,
            # A broad service may be discovered because one of its layers is a
            # trail or park. Do not let those parent keywords make unrelated
            # sibling layers (for example hospitals) look walking-relevant.
            description=candidate.description if layer_count == 1 else "",
            source_url=candidate.source_url,
            tags=candidate.tags if layer_count == 1 else (),
        )
        # A relevant single-layer item can have an opaque internal layer name.
        if not candidate.direct and layer_count > 1 and not is_relevant(layer_candidate):
            raise CrawlError("irrelevant_layer", f"layer title={layer_name!r}")
        if not candidate.direct and layer_count == 1 and not (is_relevant(layer_candidate) or is_relevant(candidate)):
            raise CrawlError("irrelevant_layer", f"layer title={layer_name!r}")
        return geometry_type

    def download_layer(
        self,
        candidate: Candidate,
        layer_id: int,
        max_features: int,
        page_size: int,
        query_where: str = "1=1",
        bbox: tuple[float, float, float, float] | None = None,
    ) -> dict[str, Any]:
        service_url = candidate.source_url.rstrip("/")
        if re.search(r"/(?:FeatureServer|MapServer)/\d+$", service_url, re.I):
            layer_url = service_url
        else:
            layer_url = f"{service_url}/{layer_id}"
        query_url = f"{layer_url}/query"
        layer_metadata, _ = self.http.json(layer_url, params={"f": "json"})
        advertised_page_size = int(layer_metadata.get("maxRecordCount") or page_size)
        effective_page_size = max(1, min(page_size, advertised_page_size))
        ids_data, _ = self.http.json(query_url, params={
            **self.selection_params(query_where, bbox),
            "returnIdsOnly": "true",
            "f": "json",
        })
        object_ids = ids_data.get("objectIds")
        if not isinstance(object_ids, list):
            raise CrawlError("object_ids_failed", "query did not return an objectIds array")
        if not object_ids:
            raise CrawlError("empty_dataset", "layer contains zero features")
        if len(object_ids) > max_features:
            raise CrawlError(
                "too_many_features",
                f"{len(object_ids)} exceeds --max-features={max_features}",
            )

        features: list[dict[str, Any]] = []
        invalid_count = 0
        for start in range(0, len(object_ids), effective_page_size):
            batch = object_ids[start : start + effective_page_size]
            params = {
                "objectIds": ",".join(str(value) for value in batch),
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": 4326,
                "returnZ": "false",
                "returnM": "false",
                "f": "geojson",
            }
            try:
                data, _ = self.http.json(query_url, params=params, method="POST")
            except CrawlError as post_error:
                self.logger.debug("ArcGIS POST failed; retrying GET: %s", post_error)
                data, _ = self.http.json(query_url, params=params)
            page_features, page_invalid = usable_features(data)
            features.extend(page_features)
            invalid_count += page_invalid
        if not features:
            raise CrawlError(
                "empty_geometry", f"all {len(object_ids)} source features have invalid geometry"
            )
        geojson = {"type": "FeatureCollection", "features": features}
        return {
            "geojson": geojson,
            "feature_count": len(features),
            "layer_id": str(layer_id),
            "source_url": query_url,
            "spatial": spatial_summary(geojson),
            "quality": coverage_quality(len(object_ids), len(features), invalid_count),
        }

    def selected_count(
        self,
        candidate: Candidate,
        layer_id: int,
        query_where: str = "1=1",
        bbox: tuple[float, float, float, float] | None = None,
    ) -> int:
        """Probe a configured ArcGIS selector without downloading its geometry."""
        service_url = candidate.source_url.rstrip("/")
        layer_url = (
            service_url
            if re.search(r"/(?:FeatureServer|MapServer)/\d+$", service_url, re.I)
            else f"{service_url}/{layer_id}"
        )
        data, _ = self.http.json(f"{layer_url}/query", params={
            **self.selection_params(query_where, bbox),
            "returnCountOnly": "true",
            "f": "json",
        })
        try:
            count = int(data["count"])
        except (KeyError, TypeError, ValueError) as exc:
            raise CrawlError("selector_failed", f"unexpected count response: {data!r}") from exc
        if count < 1:
            raise CrawlError("empty_selector", "configured ArcGIS selector matched zero features")
        return count

    @staticmethod
    def selection_params(
        query_where: str,
        bbox: tuple[float, float, float, float] | None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"where": query_where or "1=1"}
        if bbox is not None:
            south, west, north, east = bbox
            params.update({
                "geometry": f"{west},{south},{east},{north}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
            })
        return params


def load_portals(path: Path) -> list[Portal]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"State", "City", "Portal_URL", "Platform"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"portals CSV is missing columns: {', '.join(sorted(missing))}")
        portals = []
        for row_number, row in enumerate(reader, start=2):
            state = (row.get("State") or "").strip()
            city = (row.get("City") or "").strip()
            url = (row.get("Portal_URL") or "").strip()
            if not state or not city or not url:
                logging.getLogger("open_data").warning(
                    "Skipping CSV row %d: State, City, or Portal_URL is blank", row_number
                )
                continue
            portals.append(Portal(
                state=state,
                city=city,
                url=url,
                platform=(row.get("Platform") or "Other").strip() or "Other",
                status=(row.get("Status") or "").strip(),
                query_where=(row.get("Query_Where") or "1=1").strip() or "1=1",
                bbox=parse_bbox(row.get("BBox_WGS84") or ""),
            ))
    return portals


def write_geojson_exclusive(path: Path, data: dict[str, Any]) -> None:
    """Atomically create path; fail if it already exists (including a race)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".gremlin_", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp_name, path)
        except FileExistsError:
            raise CrawlError("file_exists", f"refusing to overwrite {path}")
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


class Runner:
    def __init__(self, args: argparse.Namespace, logger: logging.Logger, recorder: "Recorder"):
        self.args = args
        self.logger = logger
        self.recorder = recorder
        self.http = HttpClient(args.request_delay, args.timeout, logger)
        self.socrata = SocrataAdapter(self.http, logger)
        self.arcgis = ArcGISAdapter(self.http, logger)
        self.known_datasets = {
            dataset_key(record.state, record.city, record.platform, record.dataset_id): record
            for record in load_datasets(args.known_datasets)
            if record.dataset_id and record.status.casefold() not in {"retired", "search_again"}
        } if not args.rediscover_known else {}

    def record(self, portal: Portal, platform: str, stage: str, status: str, **kwargs: Any) -> None:
        self.recorder.add(Result(
            timestamp=utc_now(), state=portal.state, city=portal.city,
            platform=platform, stage=stage, status=status, **kwargs,
        ))

    def run_portal(self, portal: Portal) -> None:
        if (
            not self.args.include_inactive
            and portal.status.strip().casefold()
            in {"dead", "inactive", "disabled", "auth required", "manual only"}
        ):
            self.logger.info("Skipping %s, %s because Status=%s", portal.city, portal.state, portal.status)
            self.record(
                portal, portal.platform, "portal", "skipped", source_url=portal.url,
                reason="inactive_status", detail=f"Status={portal.status}",
            )
            return
        portal = self._resolve_portal(portal)
        platform = portal.platform.strip().lower()
        adapter: SocrataAdapter | ArcGISAdapter
        if platform == "socrata":
            adapter = self.socrata
        elif platform == "arcgis":
            adapter = self.arcgis
        elif platform == "other":
            adapter = self._detect_other(portal)
        else:
            self.record(portal, portal.platform, "portal", "skipped", reason="unknown_platform")
            return

        self.logger.info("%s, %s [%s] %s", portal.city, portal.state, adapter.name, portal.url)
        try:
            candidates = adapter.discover(portal)
        except CrawlError as exc:
            self.logger.warning("  discovery failed: %s - %s", exc.reason, exc.detail)
            self.record(
                portal, adapter.name, "discovery", "failed", source_url=portal.url,
                reason=exc.reason, http_status=exc.status or "", detail=exc.detail,
            )
            return
        self.record(
            portal, adapter.name, "discovery", "success", source_url=portal.url,
            feature_count=len(candidates), detail=f"{len(candidates)} relevant catalog candidates",
        )
        if isinstance(adapter, SocrataAdapter):
            undiscovered: list[Candidate] = []
            for candidate in candidates:
                known = self.known_datasets.get(
                    dataset_key(portal.state, portal.city, adapter.name, candidate.dataset_id)
                )
                if known:
                    self.record(
                        portal, adapter.name, "discovery", "skipped",
                        dataset_id=candidate.dataset_id, dataset_name=candidate.title,
                        source_url=candidate.source_url, file=known.file,
                        reason="known_dataset", detail="curated source; use updater.py to refresh",
                    )
                else:
                    undiscovered.append(candidate)
            candidates = undiscovered
        saved = 0
        handled = 0
        # Metadata checks can reject catalog matches. Permit a bounded number of
        # those rejections so a bad first match does not consume the city's file
        # quota, while still preventing an unbounded crawl of a huge catalog.
        attempt_limit = self.args.max_per_city * 4
        for candidate in sorted(
            candidates,
            key=lambda item: keyword_score(item.title, item.description, item.tags),
            reverse=True,
        ):
            if saved >= self.args.max_per_city or handled >= attempt_limit:
                break
            if isinstance(adapter, SocrataAdapter):
                saved += self._run_socrata_candidate(portal, adapter, candidate)
                handled += 1
            else:
                new_saved, new_handled = self._run_arcgis_candidate(
                    portal,
                    adapter,
                    candidate,
                    self.args.max_per_city - saved,
                    attempt_limit - handled,
                )
                saved += new_saved
                handled += new_handled
        self.logger.info("  saved %d file(s)", saved)

    def _resolve_portal(self, portal: Portal) -> Portal:
        """Follow portal migrations and recognize Socrata rows moved to ArcGIS Hub."""
        try:
            response = self.http.request("GET", portal.url)
        except CrawlError as exc:
            self.record(
                portal, portal.platform, "portal_probe", "failed", source_url=portal.url,
                reason=exc.reason, http_status=exc.status or "", detail=exc.detail,
            )
            return portal
        final_url = response.url
        body_hint = response.text[:150_000].lower() if response.status_code == 200 else ""
        detected = portal.platform
        if (
            "arcgis" in urlparse(final_url).netloc.lower()
            or "arcgis hub" in body_hint
            or "/api/search/v1" in body_hint
        ):
            detected = "ArcGIS"
        detail_parts = []
        if final_url.rstrip("/") != portal.url.rstrip("/"):
            detail_parts.append(f"redirected from {portal.url}")
        if detected.casefold() != portal.platform.casefold():
            detail_parts.append(f"platform changed from {portal.platform} to {detected}")
        # Socrata data hosts often redirect their *homepage* to a branded
        # catalogue, while /api and /resource still live at the configured data
        # hostname. ArcGIS Enterprise portals similarly redirect /portal to
        # /portal/home, while sharing/rest remains below /portal. Keep configured
        # API bases unless the redirect proved a platform migration.
        api_url = portal.url if detected.casefold() in {"socrata", "arcgis"} else final_url
        if api_url != final_url:
            detail_parts.append("kept configured API base after homepage redirect")
        status = "success" if response.status_code < 400 else "failed"
        self.record(
            portal, detected, "portal_probe", status, source_url=final_url,
            reason="" if status == "success" else "http_error",
            http_status=response.status_code, detail="; ".join(detail_parts),
        )
        return Portal(
            state=portal.state, city=portal.city, url=api_url,
            platform=detected, status=portal.status,
            query_where=portal.query_where, bbox=portal.bbox,
        )

    def _detect_other(self, portal: Portal) -> SocrataAdapter | ArcGISAdapter:
        if re.search(r"arcgis|/(?:FeatureServer|MapServer)", portal.url, re.I):
            return self.arcgis
        # "Other" is deliberately conservative.  Socrata is tried first only
        # when its metadata endpoint proves the platform; otherwise ArcGIS handles
        # the portal and produces a precise discovery diagnostic.
        base = SocrataAdapter.base_url(portal.url)
        try:
            data, _ = self.http.json(f"{base}/api/views.json", params={"limit": 1})
            if isinstance(data, list):
                return self.socrata
        except CrawlError:
            pass
        return self.arcgis

    def destination(self, portal: Portal, candidate: Candidate, suffix: str = "") -> Path:
        name = f"{slug(candidate.title)}_{candidate.dataset_id}{suffix}.geojson"
        return (
            self.args.output
            / safe_component(portal.state)
            / safe_component(portal.city)
            / name
        )

    def _run_socrata_candidate(
        self, portal: Portal, adapter: SocrataAdapter, candidate: Candidate
    ) -> int:
        path = self.destination(portal, candidate)
        common = {
            "dataset_id": candidate.dataset_id, "dataset_name": candidate.title,
            "source_url": candidate.source_url,
        }
        if path.exists():
            self.record(portal, adapter.name, "download", "skipped", file=str(path),
                        reason="file_exists", **common)
            return 0
        try:
            adapter.validate(portal, candidate)
            if self.args.dry_run:
                self.record(portal, adapter.name, "validation", "success",
                            detail="dry run; download not attempted", **common)
                return 0
            result = adapter.download(
                portal, candidate, self.args.max_features, self.args.page_size
            )
            write_geojson_exclusive(path, result["geojson"])
        except CrawlError as exc:
            self.logger.info("  skip %s: %s - %s", candidate.title, exc.reason, exc.detail)
            self.record(portal, adapter.name, "download", "failed", file=str(path),
                        reason=exc.reason, http_status=exc.status or "", detail=exc.detail,
                        **common)
            return 0
        self.logger.info("  saved %s (%s features)", path.name, result["feature_count"])
        self.record(portal, adapter.name, "download", "success", file=str(path),
                    feature_count=result["feature_count"], **result["spatial"],
                    **result["quality"], **common)
        return 1

    def _run_arcgis_candidate(
        self,
        portal: Portal,
        adapter: ArcGISAdapter,
        candidate: Candidate,
        remaining: int,
        attempt_budget: int,
    ) -> tuple[int, int]:
        try:
            layers = adapter.layers(candidate)
        except CrawlError as exc:
            self.record(
                portal, adapter.name, "service_metadata", "failed",
                dataset_id=candidate.dataset_id, dataset_name=candidate.title,
                source_url=candidate.source_url, reason=exc.reason,
                http_status=exc.status or "", detail=exc.detail,
            )
            return 0, 1
        saved = 0
        handled = 0
        for layer_id, layer_name, metadata in layers:
            if saved >= remaining or handled >= attempt_budget:
                break
            layer_dataset_id = f"{candidate.dataset_id}_{layer_id}"
            path = self.destination(portal, candidate, f"_{layer_id}")
            common = {
                "dataset_id": layer_dataset_id,
                "dataset_name": f"{candidate.title} / {layer_name}",
                "source_url": (
                    candidate.source_url
                    if re.search(r"/(?:FeatureServer|MapServer)/\d+$", candidate.source_url, re.I)
                    else f"{candidate.source_url.rstrip('/')}/{layer_id}"
                ),
            }
            known = self.known_datasets.get(
                dataset_key(portal.state, portal.city, adapter.name, layer_dataset_id)
            )
            if known:
                self.record(
                    portal, adapter.name, "discovery", "skipped", file=known.file,
                    reason="known_dataset", detail="curated source; use updater.py to refresh",
                    **common,
                )
                continue
            handled += 1
            if path.exists():
                self.record(portal, adapter.name, "download", "skipped", file=str(path),
                            reason="file_exists", **common)
                continue
            try:
                adapter.validate_layer(candidate, layer_id, layer_name, metadata, len(layers))
                if self.args.dry_run:
                    selected_count = adapter.selected_count(
                        candidate, layer_id, portal.query_where, portal.bbox
                    )
                    if selected_count > self.args.max_features:
                        raise CrawlError(
                            "too_many_features",
                            f"{selected_count} exceeds --max-features={self.args.max_features}",
                        )
                    self.record(portal, adapter.name, "validation", "success",
                                feature_count=selected_count,
                                detail="dry run; selector matched live features", **common)
                    continue
                result = adapter.download_layer(
                    candidate, layer_id, self.args.max_features, self.args.page_size,
                    portal.query_where, portal.bbox,
                )
                write_geojson_exclusive(path, result["geojson"])
            except CrawlError as exc:
                self.logger.info("  skip %s / %s: %s - %s", candidate.title, layer_name,
                                 exc.reason, exc.detail)
                self.record(portal, adapter.name, "download", "failed", file=str(path),
                            reason=exc.reason, http_status=exc.status or "", detail=exc.detail,
                            **common)
                continue
            self.logger.info("  saved %s (%s features)", path.name, result["feature_count"])
            self.record(portal, adapter.name, "download", "success", file=str(path),
                        feature_count=result["feature_count"], **result["spatial"],
                        **result["quality"], **common)
            saved += 1
        return saved, handled


class Recorder:
    fields = tuple(Result.__dataclass_fields__)

    def __init__(self, path: Path):
        self.path = path
        self.rows: list[Result] = []

    def add(self, result: Result) -> None:
        self.rows.append(result)

    def write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("x", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=self.fields)
            writer.writeheader()
            writer.writerows(asdict(row) for row in self.rows)


def configure_logging(log_path: Path, verbose: bool) -> logging.Logger:
    logger = logging.getLogger("open_data")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()
    file_handler = logging.FileHandler(log_path, mode="x", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%S%z"
    ))
    console = logging.StreamHandler()
    console.setLevel(logging.DEBUG if verbose else logging.INFO)
    console.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    logger.addHandler(file_handler)
    logger.addHandler(console)
    return logger


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portals", type=Path, default=DEFAULT_PORTALS)
    parser.add_argument("--known-datasets", type=Path, default=DEFAULT_DATASETS,
                        help="Curated dataset registry whose source IDs skip rediscovery")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--state", help="Process only this state (case-insensitive)")
    parser.add_argument("--city", help="Process only this city (case-insensitive)")
    parser.add_argument("--platform", choices=("Socrata", "ArcGIS", "Other"))
    parser.add_argument("--max-per-city", type=int, default=12)
    parser.add_argument("--max-features", type=int, default=100_000)
    parser.add_argument("--page-size", type=int, default=2_000)
    parser.add_argument("--request-delay", type=float, default=0.35)
    parser.add_argument("--portal-delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=40.0)
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover and validate metadata without downloading")
    parser.add_argument("--rediscover-known", action="store_true",
                        help="Ignore datasets.csv and search previously gathered source IDs again")
    parser.add_argument("--boundary-only", action="store_true",
                        help="Discover only official city, jurisdiction, and neighborhood boundary candidates")
    parser.add_argument(
        "--include-inactive", action="store_true",
        help="Also probe rows marked Dead, Inactive, Disabled, Auth required, or Manual only",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    global SEARCH_TERMS
    args = build_parser().parse_args(argv)
    if args.boundary_only:
        SEARCH_TERMS = ("city boundary", "municipal boundary", "jurisdiction boundary", "neighborhood boundary")
    args.portals = args.portals.resolve()
    args.known_datasets = args.known_datasets.resolve()
    args.output = args.output.resolve()
    if args.max_per_city < 1 or args.max_features < 1 or args.page_size < 1:
        raise SystemExit("max-per-city, max-features, and page-size must be positive")
    run_stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    log_dir = args.output / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"scraper_{run_stamp}.log"
    csv_path = log_dir / f"results_{run_stamp}.csv"
    logger = configure_logging(log_path, args.verbose)
    recorder = Recorder(csv_path)
    try:
        portals = load_portals(args.portals)
    except (OSError, ValueError) as exc:
        logger.error("Cannot load %s: %s", args.portals, exc)
        return 2
    if args.state:
        portals = [p for p in portals if p.state.casefold() == args.state.casefold()]
    if args.city:
        portals = [p for p in portals if p.city.casefold() == args.city.casefold()]
    if args.platform:
        portals = [p for p in portals if p.platform.casefold() == args.platform.casefold()]
    logger.info("Processing %d portal(s); dry_run=%s", len(portals), args.dry_run)
    runner = Runner(args, logger, recorder)
    try:
        for index, portal in enumerate(portals):
            try:
                runner.run_portal(portal)
            except Exception as exc:  # keep one malformed portal from ending the run
                logger.exception("Unexpected failure for %s, %s", portal.city, portal.state)
                runner.record(
                    portal, portal.platform, "portal", "failed", source_url=portal.url,
                    reason="unexpected_error", detail=f"{type(exc).__name__}: {exc}",
                )
            if index + 1 < len(portals) and args.portal_delay > 0:
                time.sleep(args.portal_delay)
    except KeyboardInterrupt:
        logger.warning("Interrupted; writing partial diagnostics")
    finally:
        recorder.write()
    successes = sum(row.status == "success" and row.stage == "download" for row in recorder.rows)
    failures = sum(row.status == "failed" for row in recorder.rows)
    logger.info("Finished: %d download(s), %d failure record(s)", successes, failures)
    logger.info("Diagnostic CSV: %s", csv_path)
    logger.info("Detailed log: %s", log_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
