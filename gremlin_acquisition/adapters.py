"""Typed, replayable POI acquisition adapters for configured source formats."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .package_intelligence import POIRecord, normalize_poi, validate_poi


def parse_feed(body: str | bytes, config: dict) -> AdapterResult:
    """Parse RSS/Atom entries into reviewable records using feedparser."""
    import feedparser
    parsed = feedparser.parse(body)
    records = []
    mapping = config.get('propertyMapping') or {}
    for index, entry in enumerate(parsed.entries):
        title = str(entry.get(mapping.get('name', 'title'), '')).strip()
        url = entry.get(mapping.get('officialUrl', 'link')) or config['url']
        updated = entry.get(mapping.get('updatedAt', 'updated')) or entry.get('published')
        records.append(normalize_poi(POIRecord(
            str(entry.get(mapping.get('id', 'id')) or entry.get('link') or f'feed-{index}'),
            title, str(config.get('category') or (config.get('domains') or ['event'])[0]),
            config['url'], official_url=str(url), source_updated_at=str(updated) if updated else None,
            attributes=dict(config.get('attributes') or {}),
        )))
    errors = tuple(f'{record.record_id}: {error}' for record in records for error in validate_poi(record))
    status = 'SUCCEEDED' if records and not errors else ('PARTIAL' if records else 'FAILED')
    return AdapterResult('rss_atom', config['url'], status, tuple(records), errors)


def parse_socrata(body: str | bytes, config: dict) -> AdapterResult:
    """Parse Socrata JSON rows using the same mapping contract as GeoJSON."""
    import json
    try:
        rows = json.loads(body) if isinstance(body, (str, bytes)) else body
    except (TypeError, json.JSONDecodeError) as exc:
        return AdapterResult('socrata', config['url'], 'FAILED', errors=(f'invalid JSON: {exc}',))
    records = []
    mapping = config.get('propertyMapping') or {}
    for index, row in enumerate(rows if isinstance(rows, list) else []):
        if not isinstance(row, dict):
            continue
        name = row.get(mapping.get('name', 'name')) or row.get('title') or ''
        record_id = row.get(mapping.get('id', 'id')) or row.get('objectid') or f'row-{index}'
        lat = row.get(mapping.get('latitude', 'latitude'))
        lon = row.get(mapping.get('longitude', 'longitude'))
        records.append(normalize_poi(POIRecord(
            str(record_id), str(name), str(row.get(mapping.get('category', 'category')) or config.get('category') or (config.get('domains') or ['place'])[0]),
            config['url'], float(lat) if lat not in (None, '') else None,
            float(lon) if lon not in (None, '') else None,
            official_url=row.get(mapping.get('officialUrl', 'official_url')),
            source_updated_at=row.get(mapping.get('updatedAt', 'updated_at')),
            attributes=dict(config.get('attributes') or {}),
        )))
    errors = tuple(f'{record.record_id}: {error}' for record in records for error in validate_poi(record))
    status = 'SUCCEEDED' if records and not errors else ('PARTIAL' if records else 'FAILED')
    return AdapterResult('socrata', config['url'], status, tuple(records), errors)


def socrata_page_params(*, offset: int = 0, limit: int = 1000, order: str | None = None) -> dict:
    """Build stable SODA pagination parameters for complete regional pulls."""
    if offset < 0 or limit <= 0:
        raise ValueError('offset must be non-negative and limit must be positive')
    params = {'$limit': str(limit), '$offset': str(offset)}
    if order:
        params['$order'] = order
    return params


def acquire_socrata_pages(config: dict, transport: Callable[[str], str], *, page_size: int = 1000,
                          max_pages: int = 100) -> AdapterResult:
    """Acquire bounded Socrata pages and retain page failures in adapter errors."""
    from urllib.parse import urlencode
    if max_pages <= 0:
        raise ValueError('max_pages must be positive')
    all_records: list[POIRecord] = []
    errors: list[str] = []
    pages_attempted = 0
    stopped_on_short_page = False
    for page in range(max_pages):
        pages_attempted += 1
        offset = page * page_size
        url = config['url'] + ('&' if '?' in config['url'] else '?') + urlencode(
            socrata_page_params(offset=offset, limit=page_size, order=config.get('order'))
        )
        try:
            result = parse_socrata(transport(url), config)
        except Exception as exc:
            errors.append(f'page {page} offset {offset}: {exc}')
            break
        all_records.extend(result.records)
        errors.extend(f'page {page}: {error}' for error in result.errors)
        if len(result.records) < page_size:
            stopped_on_short_page = True
            break
    status = 'SUCCEEDED' if all_records and not errors else ('PARTIAL' if all_records else 'FAILED')
    return AdapterResult('socrata', config['url'], status, tuple(all_records), tuple(errors), metadata={
        'pagesAttempted': pages_attempted, 'pageSize': page_size,
        'maxPages': max_pages, 'stoppedOnShortPage': stopped_on_short_page,
    })


def parse_html_directory(body: str | bytes, config: dict) -> AdapterResult:
    """Extract reviewable linked directory entries from structured HTML."""
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin
    soup = BeautifulSoup(body, 'lxml')
    selector = config.get('entrySelector', 'a')
    records = []
    for index, node in enumerate(soup.select(selector)):
        name = node.get_text(' ', strip=True)
        href = node.get('href')
        if not name or not href or href.startswith('#'):
            continue
        attributes = dict(config.get('attributes') or {})
        date_node = node.select_one(config['dateSelector']) if config.get('dateSelector') else None
        location_node = node.select_one(config['locationSelector']) if config.get('locationSelector') else None
        if date_node:
            attributes['start'] = date_node.get_text(' ', strip=True)
        if location_node:
            attributes['location'] = location_node.get_text(' ', strip=True)
        records.append(POIRecord(
            str(node.get('data-id') or href), name,
            str(config.get('category') or (config.get('domains') or ['place'])[0]),
            config['url'], official_url=urljoin(config['url'], href),
            attributes=attributes,
        ))
    errors = tuple(f'{record.record_id}: {error}' for record in records for error in validate_poi(record))
    status = 'SUCCEEDED' if records and not errors else ('PARTIAL' if records else 'FAILED')
    return AdapterResult('html_directory', config['url'], status, tuple(records), errors)


def parse_jsonld_events(body: str | bytes, config: dict) -> AdapterResult:
    """Extract schema.org Event JSON-LD embedded in official HTML pages."""
    import json
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(body, 'lxml')
    records = []
    for index, node in enumerate(soup.select('script[type="application/ld+json"]')):
        try:
            payload = json.loads(node.string or node.get_text())
        except (TypeError, json.JSONDecodeError):
            continue
        values = payload if isinstance(payload, list) else payload.get('@graph', [payload]) if isinstance(payload, dict) else []
        for event in values:
            event_type = event.get('@type') if isinstance(event, dict) else None
            if event_type != 'Event' and event_type != ['Event']:
                continue
            location = event.get('location') or {}
            location_name = location.get('name') if isinstance(location, dict) else str(location)
            attributes = {'start': event.get('startDate'), 'end': event.get('endDate'), 'location': location_name}
            geo = location.get('geo') if isinstance(location, dict) else {}
            lat = geo.get('latitude') if isinstance(geo, dict) else None
            lon = geo.get('longitude') if isinstance(geo, dict) else None
            records.append(POIRecord(
                str(event.get('identifier') or event.get('url') or f'event-{index}-{len(records)}'),
                str(event.get('name') or ''), 'event', config['url'],
                float(lat) if lat is not None else None, float(lon) if lon is not None else None,
                official_url=event.get('url') or config['url'], source_updated_at=event.get('startDate'),
                attributes={**dict(config.get('attributes') or {}), **attributes},
            ))
    timing_errors = tuple(
        f'{record.record_id}: missing JSON-LD startDate'
        for record in records if not record.attributes.get('start')
    )
    errors = timing_errors + tuple(f'{record.record_id}: {error}' for record in records for error in validate_poi(record))
    status = 'SUCCEEDED' if records and not errors else ('PARTIAL' if records else 'FAILED')
    return AdapterResult('jsonld_events', config['url'], status, tuple(records), errors)


def parse_icalendar_events(body: str | bytes, config: dict) -> AdapterResult:
    """Extract VEVENT entries from an official iCalendar feed.

    ICS is common for municipal calendars and preserves stable UIDs even when
    the human-facing calendar is rendered by JavaScript.  Dates are retained
    as ISO-like strings in attributes so the review artifact remains portable.
    """
    from icalendar import Calendar

    try:
        calendar = Calendar.from_ical(body)
    except Exception as exc:
        return AdapterResult('icalendar', config['url'], 'FAILED', errors=(f'invalid ICS: {exc}',))

    records = []
    errors = []
    for index, component in enumerate(calendar.walk('VEVENT')):
        def text(name):
            value = component.get(name)
            if value is None:
                return None
            return str(value.to_ical(), 'utf-8') if hasattr(value, 'to_ical') else str(value)

        name = text('SUMMARY') or ''
        uid = text('UID') or f'event-{index}'
        start = component.get('DTSTART').dt if component.get('DTSTART') else None
        end = component.get('DTEND').dt if component.get('DTEND') else None
        location = text('LOCATION')
        official_url = text('URL') or config['url']
        updated = component.get('LAST-MODIFIED') or component.get('DTSTAMP')
        updated_text = str(updated.dt) if updated is not None and hasattr(updated, 'dt') else text('LAST-MODIFIED')
        attributes = {**dict(config.get('attributes') or {}), 'start': str(start) if start is not None else None,
                      'end': str(end) if end is not None else None, 'location': location}
        record = normalize_poi(POIRecord(
            uid, name, str(config.get('category') or 'event'), config['url'],
            official_url=official_url, source_updated_at=updated_text, attributes=attributes,
        ))
        records.append(record)
        if not start:
            errors.append(f'{uid}: missing DTSTART')
    errors.extend(f'{record.record_id}: {error}' for record in records for error in validate_poi(record))
    status = 'SUCCEEDED' if records and not errors else ('PARTIAL' if records else 'FAILED')
    return AdapterResult('icalendar', config['url'], status, tuple(records), tuple(errors), metadata={
        'calendarMethod': str(calendar.get('X-WR-CALNAME') or ''),
        'eventCount': len(records),
    })


def _representative_point(geometry: dict) -> tuple[float | None, float | None]:
    """Return a deterministic lon/lat representative point for GeoJSON geometry."""
    if not isinstance(geometry, dict):
        return None, None
    coords = geometry.get('coordinates')
    if geometry.get('x') is not None and geometry.get('y') is not None:
        return geometry['x'], geometry['y']
    if coords is None:
        coords = geometry.get('rings') or geometry.get('paths') or geometry.get('points')
    if geometry.get('type') == 'Point' and isinstance(coords, (list, tuple)) and len(coords) >= 2:
        return coords[0], coords[1]
    points: list[tuple[float, float]] = []
    def walk(value):
        if isinstance(value, (list, tuple)) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            points.append((float(value[0]), float(value[1])))
        elif isinstance(value, (list, tuple)):
            for child in value:
                walk(child)
    walk(coords)
    if not points:
        return None, None
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


@dataclass(frozen=True)
class AdapterResult:
    provider: str
    source_url: str
    status: str
    records: tuple[POIRecord, ...] = ()
    errors: tuple[str, ...] = ()
    raw_sha256: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class FallbackResult:
    selected: AdapterResult | None
    attempts: tuple[AdapterResult, ...]
    status: str
    reason: str


def source_health(result: AdapterResult) -> dict:
    """Create compact, reviewable health evidence for one adapter attempt."""
    return {
        'provider': result.provider,
        'url': result.source_url,
        'status': result.status,
        'recordCount': len(result.records),
        'errorCount': len(result.errors),
        'errors': list(result.errors),
        'rawSha256': result.raw_sha256,
        'metadata': dict(result.metadata),
    }


def discover_arcgis_layers(document: dict, service_url: str, *, domains=()) -> tuple[dict, ...]:
    """Turn an ArcGIS service-root metadata document into layer configs.

    Discovery is intentionally side-effect free: callers can persist these
    configs as PROPOSED sources and require human approval before acquisition.
    Tables are excluded because they do not provide mappable POIs.
    """
    if not isinstance(document, dict):
        return ()
    base = service_url.rstrip('/')
    rows = []
    for kind in ('layers',):
        for layer in document.get(kind) or ():
            if not isinstance(layer, dict) or layer.get('id') is None or not layer.get('name'):
                continue
            layer_url = f"{base}/{layer['id']}"
            rows.append({
                'provider': 'arcgis_feature_service',
                'url': layer_url,
                'domains': list(domains),
                'discoveredLayer': str(layer['name']),
                'discoveredFrom': service_url,
                'status': 'PROPOSED',
            })
    return tuple(sorted(rows, key=lambda row: row['url']))


def arcgis_query_params(metadata: dict, *, where='1=1', out_sr=4326, offset=0,
                        page_size=None) -> dict:
    """Build a portable ArcGIS query request from layer metadata."""
    limit = page_size or metadata.get('maxRecordCount') or 1000
    return {
        'where': where,
        'outFields': '*',
        'returnGeometry': 'true',
        'outSR': str(out_sr),
        'f': 'geojson' if 'geoJSON' in (metadata.get('supportedQueryFormats') or '') else 'json',
        'resultOffset': str(offset),
        'resultRecordCount': str(limit),
    }


def _category(config: dict, default="place") -> str:
    domains = config.get("domains") or []
    constants = (config.get("propertyMapping") or {}).get("constants") or {}
    return str(constants.get("type") or (config.get("category") if config.get("category") else (domains[0] if domains else default)))


def _record(config: dict, feature: dict, index: int) -> POIRecord:
    props = feature.get("properties") or {}
    mapping = config.get("propertyMapping") or {}
    record_id = props.get(mapping.get("id", "id")) or feature.get("id") or f"row-{index}"
    name = props.get(mapping.get("name", "name"))
    if not name:
        for fallback in mapping.get("nameFallbacks", []):
            if props.get(fallback):
                name = props[fallback]
                break
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    if geometry.get("x") is not None and geometry.get("y") is not None:
        lon, lat = geometry["x"], geometry["y"]
    elif geometry.get("type") in {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"} or any(key in geometry for key in ("rings", "paths", "points")):
        lon, lat = _representative_point(geometry)
    else:
        lat = lon = None
    attributes = {key: props[key] for key in mapping.get("include", []) if key in props}
    attributes.update(mapping.get("constants", {}))
    category = props.get(mapping.get("category", "category")) or _category(config)
    official_field = mapping.get("officialUrl") or mapping.get("official_url")
    updated_field = mapping.get("updatedAt") or mapping.get("sourceUpdatedAt")
    official_url = props.get(official_field) if official_field else None
    source_updated_at = props.get(updated_field) if updated_field else None
    return normalize_poi(POIRecord(
        str(record_id), str(name or ""), str(category), config["url"], lat, lon,
        official_url=str(official_url) if official_url else None,
        attributes=attributes,
        source_updated_at=str(source_updated_at) if source_updated_at else None,
    ))


def parse_geojson(body: dict, config: dict) -> AdapterResult:
    features = body.get("features") or []
    records = tuple(_record(config, feature, i) for i, feature in enumerate(features))
    errors = tuple(f"{record.record_id}: {error}" for record in records for error in validate_poi(record))
    return AdapterResult("geojson", config["url"], "SUCCEEDED" if not errors else "PARTIAL", records, errors)


def parse_ogc_records(body: dict | str, config: dict) -> AdapterResult:
    """Parse OGC API - Records items using the GeoJSON feature contract."""
    import json
    try:
        document = json.loads(body) if isinstance(body, str) else body
    except (TypeError, json.JSONDecodeError) as exc:
        return AdapterResult('ogc_records', config['url'], 'FAILED', errors=(f'invalid JSON: {exc}',))
    result = parse_geojson(document, config)
    return AdapterResult('ogc_records', result.source_url, result.status, result.records, result.errors,
                         result.raw_sha256, {'catalog': config.get('catalog'), 'collection': config.get('collection')})


def parse_arcgis(body: dict, config: dict) -> AdapterResult:
    features = [{"type": "Feature", "properties": row.get("attributes", {}), "geometry": row.get("geometry") or {}}
                for row in body.get("features") or []]
    for feature, row in zip(features, body.get("features") or []):
        feature["id"] = row.get("attributes", {}).get((config.get("propertyMapping") or {}).get("id", "OBJECTID"))
    records = tuple(_record(config, feature, i) for i, feature in enumerate(features))
    errors = tuple(f"{record.record_id}: {error}" for record in records for error in validate_poi(record))
    return AdapterResult("arcgis_feature_service", config["url"], "SUCCEEDED" if not errors else "PARTIAL", records, errors)


def acquire(config: dict, transport: Callable[[str], str]) -> AdapterResult:
    """Acquire one configured source using an injected transport/replay body."""
    provider = config.get("provider", "geojson")
    if provider in {"socrata", "soda"} and config.get('paginate', True):
        return acquire_socrata_pages(
            config, transport,
            page_size=int(config.get('pageSize', 1000)),
            max_pages=int(config.get('maxPages', 100)),
        )
    body = transport(config["url"])
    if provider in {"rss", "atom", "rss_atom"}:
        return parse_feed(body, config)
    if provider in {"socrata", "soda"}:
        return parse_socrata(body, config)
    if provider in {"ogc_records", "ogc_api_records"}:
        return parse_ogc_records(body, config)
    if provider in {"html", "html_directory"}:
        return parse_html_directory(body, config)
    if provider in {"jsonld_events", "jsonld"}:
        return parse_jsonld_events(body, config)
    if provider in {"icalendar", "ics", "ical"}:
        return parse_icalendar_events(body, config)
    import json
    try:
        document = json.loads(body) if isinstance(body, str) else body
    except (TypeError, json.JSONDecodeError) as exc:
        return AdapterResult(config.get("provider", "unknown"), config["url"], "FAILED", errors=(f"invalid JSON: {exc}",))
    if provider == "arcgis_feature_service" or "features" in document and "objectIdFieldName" in document:
        return parse_arcgis(document, config)
    return parse_geojson(document, config)


def acquire_with_fallback(configs, transport: Callable[[str], str]) -> FallbackResult:
    """Try equivalent configured sources in order and preserve every outcome."""
    attempts = []
    for config in configs:
        try:
            result = acquire(config, transport)
        except Exception as exc:  # provider boundary: keep failure auditable
            result = AdapterResult(config.get("provider", "unknown"), config.get("url", ""), "FAILED", errors=(str(exc),))
        attempts.append(result)
        if result.status == "SUCCEEDED" and result.records:
            reason = "selected first successful source with records"
            if len(attempts) > 1:
                reason += f" after {len(attempts) - 1} prior failure or empty attempt(s)"
            return FallbackResult(result, tuple(attempts), "SUCCEEDED", reason)
    if any(result.status == "PARTIAL" for result in attempts):
        return FallbackResult(next(result for result in attempts if result.status == "PARTIAL"), tuple(attempts), "PARTIAL", "all sources failed to provide a fully valid result")
    return FallbackResult(None, tuple(attempts), "FAILED", "all configured fallback sources failed or were empty")
