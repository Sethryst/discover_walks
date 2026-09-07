"""State-at-a-time OSM data factory for immutable PMTiles artifacts.

This module is intentionally build-time only.  It never serves tiles and it
does not replace the bounded regional Overpass enrichment adapter.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = "1"
PIPELINE_VERSION = "1"
CENSUS_VERSION = "2025-500k"
CENSUS_URL = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_500k.zip"
GEOFABRIK_ROOT = "https://download.geofabrik.de/north-america/us"

# Keep these selectors separate from POIs.  Referenced nodes/members are kept
# by osmium so line and multipolygon geometry remains usable downstream.
ROADWAY_EXPRESSIONS = (
    "w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,residential,unclassified,service,living_street,pedestrian,track,path,footway,cycleway,steps,bridleway,corridor",
    "wr/route=foot,hiking,bicycle",
    "nwr/public_transport=platform",
    "nwr/railway=platform",
    "a/leisure=park,nature_reserve,garden,playground,dog_park,recreation_ground",
    "a/natural=water,wood,beach,wetland",
    "a/landuse=forest,grass,meadow,recreation_ground,village_green",
)

# This is intentionally conservative.  High-volume food/retail data belongs
# in the bounded regional pipeline unless a future measured release justifies
# broadening the state allowlist.  Never add bare key selectors here.
POI_EXPRESSIONS = (
    "nwr/amenity=drinking_water,toilets,shelter,library,marketplace",
    "nwr/tourism=artwork,viewpoint,museum,gallery,attraction",
    "nwr/leisure=playground,picnic_table,slipway",
    "nwr/natural=beach,spring,peak,cave_entrance",
    "nwr/historic=monument,memorial,archaeological_site,ruins,castle,fort,battlefield",
    "nwr/shop=coffee",
)

POI_ALLOWED: dict[str, frozenset[str]] = {
    "amenity": frozenset({"drinking_water", "toilets", "shelter", "library", "marketplace"}),
    "tourism": frozenset({"artwork", "viewpoint", "museum", "gallery", "attraction"}),
    "leisure": frozenset({"playground", "picnic_table", "slipway"}),
    "natural": frozenset({"beach", "spring", "peak", "cave_entrance"}),
    "historic": frozenset({"monument", "memorial", "archaeological_site", "ruins", "castle", "fort", "battlefield"}),
    "shop": frozenset({"coffee"}),
}


@dataclass(frozen=True, slots=True)
class StateMetadata:
    code: str
    fips: str
    name: str
    slug: str
    source_slug: str | None
    bbox: tuple[float, float, float, float] | None = None
    polygon_path: str | None = None
    polygon_sha256: str | None = None

    @property
    def id(self) -> str:
        return f"us-{self.code.lower()}"

    @property
    def source_url(self) -> str | None:
        return f"{GEOFABRIK_ROOT}/{self.source_slug}-latest.osm.pbf" if self.source_slug else None


_STATE_ROWS = """
AL|01|Alabama|alabama
AK|02|Alaska|alaska
AZ|04|Arizona|arizona
AR|05|Arkansas|arkansas
CA|06|California|california
CO|08|Colorado|colorado
CT|09|Connecticut|connecticut
DE|10|Delaware|delaware
DC|11|District of Columbia|district-of-columbia
FL|12|Florida|florida
GA|13|Georgia|georgia
HI|15|Hawaii|hawaii
ID|16|Idaho|idaho
IL|17|Illinois|illinois
IN|18|Indiana|indiana
IA|19|Iowa|iowa
KS|20|Kansas|kansas
KY|21|Kentucky|kentucky
LA|22|Louisiana|louisiana
ME|23|Maine|maine
MD|24|Maryland|maryland
MA|25|Massachusetts|massachusetts
MI|26|Michigan|michigan
MN|27|Minnesota|minnesota
MS|28|Mississippi|mississippi
MO|29|Missouri|missouri
MT|30|Montana|montana
NE|31|Nebraska|nebraska
NV|32|Nevada|nevada
NH|33|New Hampshire|new-hampshire
NJ|34|New Jersey|new-jersey
NM|35|New Mexico|new-mexico
NY|36|New York|new-york
NC|37|North Carolina|north-carolina
ND|38|North Dakota|north-dakota
OH|39|Ohio|ohio
OK|40|Oklahoma|oklahoma
OR|41|Oregon|oregon
PA|42|Pennsylvania|pennsylvania
RI|44|Rhode Island|rhode-island
SC|45|South Carolina|south-carolina
SD|46|South Dakota|south-dakota
TN|47|Tennessee|tennessee
TX|48|Texas|texas
UT|49|Utah|utah
VT|50|Vermont|vermont
VA|51|Virginia|virginia
WA|53|Washington|washington
WV|54|West Virginia|west-virginia
WI|55|Wisconsin|wisconsin
WY|56|Wyoming|wyoming
AS|60|American Samoa|-
GU|66|Guam|-
MP|69|Northern Mariana Islands|-
PR|72|Puerto Rico|-
VI|78|U.S. Virgin Islands|-
""".strip().splitlines()

STATES: dict[str, StateMetadata] = {}
for _row in _STATE_ROWS:
    _code, _fips, _name, _source = _row.split("|", 3)
    STATES[_code] = StateMetadata(_code, _fips, _name, _name.casefold().replace(" ", "-"), None if _source == "-" else _source)


class BuildError(RuntimeError):
    """A data-factory step failed without claiming an artifact is valid."""


def resolve_state(value: str) -> StateMetadata:
    token = value.strip().upper().removeprefix("US-")
    if token in STATES:
        return STATES[token]
    matches = [state for state in STATES.values() if value.strip().casefold() in {state.name.casefold(), state.slug}]
    if len(matches) == 1:
        return matches[0]
    raise ValueError(f"Unknown state/equivalent {value!r}; use a USPS code such as VA.")


def hash_file(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_file(path: Path) -> str:
    return hash_file(path, "sha256")


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(payload, stream, indent=2, sort_keys=True, ensure_ascii=False)
            stream.write("\n")
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def tool_inventory() -> dict[str, dict[str, str | None]]:
    commands = {"osmium": "osmium", "tippecanoe": "tippecanoe", "tile-join": "tile-join", "pmtiles": "pmtiles", "ogr2ogr": "ogr2ogr"}
    output: dict[str, dict[str, str | None]] = {}
    for label, command in commands.items():
        location = shutil.which(command)
        version = None
        if location:
            arguments = ["version"] if label in {"osmium", "pmtiles"} else ["--help"] if label == "tile-join" else ["--version"]
            result = subprocess.run([location, *arguments], capture_output=True, text=True, check=False)
            version = (result.stdout or result.stderr).strip().splitlines()[0] if (result.stdout or result.stderr).strip() else "available"
            if label == "tile-join":
                sibling = shutil.which("tippecanoe")
                sibling_result = subprocess.run([sibling, "--version"], capture_output=True, text=True, check=False) if sibling else None
                version = f"bundled with {(sibling_result.stdout or sibling_result.stderr).strip()}" if sibling_result else "available"
            elif label == "pmtiles" and " dev" in version:
                module = subprocess.run(["go", "version", "-m", location], capture_output=True, text=True, check=False)
                module_line = next((line.strip() for line in module.stdout.splitlines() if line.lstrip().startswith("mod\tgithub.com/protomaps/go-pmtiles")), None)
                if module_line:
                    parts = module_line.split()
                    version = f"go-pmtiles {parts[2]}" if len(parts) > 2 else module_line
        output[label] = {"path": location, "version": version}
    return output


def require_tools(*names: str) -> dict[str, dict[str, str | None]]:
    inventory = tool_inventory()
    missing = [name for name in names if not inventory[name]["path"]]
    if missing:
        raise BuildError("Missing build dependencies: " + ", ".join(missing) + ". Run the preflight command for installation guidance.")
    return inventory


def download_file(url: str, destination: Path) -> dict[str, Any]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Gremlin-Lab-OSM-Builder/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
        shutil.copyfileobj(response, stream, length=1024 * 1024)
        headers = dict(response.headers.items())
    os.replace(temporary, destination)
    return {"url": url, "bytes": destination.stat().st_size, "sha256": sha256_file(destination), "lastModified": headers.get("Last-Modified")}


def prepare_boundary(state: StateMetadata, root: Path, *, allow_download: bool = True) -> StateMetadata:
    """Materialize exactly one Census polygon and derive its authoritative bbox."""
    source_dir = root / "sources" / "census" / CENSUS_VERSION
    archive = source_dir / Path(CENSUS_URL).name
    national_geojson = source_dir / "states.geojson"
    if not national_geojson.exists():
        if not archive.exists():
            if not allow_download:
                raise BuildError(f"Census boundary cache is missing: {archive}")
            metadata = download_file(CENSUS_URL, archive)
            atomic_json(source_dir / "source.json", {**metadata, "version": CENSUS_VERSION})
        ogr2ogr = require_tools("ogr2ogr")["ogr2ogr"]["path"]
        with zipfile.ZipFile(archive) as bundle:
            shape_name = next(name for name in bundle.namelist() if name.endswith(".shp"))
            bundle.extractall(source_dir / "shp")
        _run([str(ogr2ogr), "-f", "GeoJSON", "-t_srs", "EPSG:4326", "-lco", "RFC7946=YES", str(national_geojson), str(source_dir / "shp" / shape_name)])
    collection = json.loads(national_geojson.read_text(encoding="utf-8"))
    feature = next((item for item in collection.get("features", []) if str(item.get("properties", {}).get("GEOID")) == state.fips), None)
    if feature is None:
        raise BuildError(f"Census {CENSUS_VERSION} has no polygon for FIPS {state.fips} ({state.code}).")
    polygon = {"type": "FeatureCollection", "features": [feature]}
    polygon_path = root / "boundaries" / CENSUS_VERSION / f"{state.id}.geojson"
    atomic_json(polygon_path, polygon)
    bbox = geometry_bbox(feature["geometry"])
    return replace(state, bbox=bbox, polygon_path=str(polygon_path.resolve()), polygon_sha256=sha256_file(polygon_path))


def geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    points = list(_coordinate_pairs(geometry.get("coordinates", [])))
    if not points:
        raise ValueError("Geometry has no coordinate pairs.")
    xs, ys = zip(*points)
    return min(xs), min(ys), max(xs), max(ys)


def _coordinate_pairs(value: Any) -> Iterator[tuple[float, float]]:
    if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
        yield float(value[0]), float(value[1])
    elif isinstance(value, list):
        for child in value:
            yield from _coordinate_pairs(child)


def state_plan(state_value: str, release: str, root: Path, *, with_poi: bool = False, allow_boundary_download: bool = True) -> dict[str, Any]:
    state = prepare_boundary(resolve_state(state_value), root, allow_download=allow_boundary_download)
    if not state.source_url:
        source_status = "unsupported_by_default_provider"
    else:
        source_status = "resolved"
    return {
        "release": release,
        "schemaVersion": SCHEMA_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "state": state_public_dict(state),
        "source": {"provider": "Geofabrik", "url": state.source_url, "status": source_status},
        "extraction": {"polygonPath": state.polygon_path, "strategy": "smart", "finalBoundary": "census_polygon"},
        "products": ["roadway", *( ["poi"] if with_poi else [])],
        "poiCoupledToRoadway": False,
        "expressions": {"roadway": list(ROADWAY_EXPRESSIONS), **({"poi": list(POI_EXPRESSIONS)} if with_poi else {})},
        "tools": tool_inventory(),
        "upload": "disabled_unless_publish_dir_is_explicit",
    }


def state_public_dict(state: StateMetadata) -> dict[str, Any]:
    return {
        "id": state.id, "code": state.code, "fips": state.fips, "name": state.name,
        "bbox": list(state.bbox) if state.bbox else None,
        "polygon": {"source": "US Census Bureau", "version": CENSUS_VERSION, "url": CENSUS_URL, "sha256": state.polygon_sha256},
    }


def strict_poi_match(tags: dict[str, Any]) -> bool:
    """Second allowlist gate applied after osmium's early PBF filter."""
    return any(str(tags.get(key, "")) in allowed for key, allowed in POI_ALLOWED.items())


def normalize_poi_feature(feature: dict[str, Any], *, state: StateMetadata, release: str) -> dict[str, Any] | None:
    properties = dict(feature.get("properties") or {})
    tags = dict(properties.get("tags") or properties)
    if not strict_poi_match(tags) or not feature.get("geometry"):
        return None
    osm_type = str(properties.get("type") or properties.get("@type") or "unknown")
    osm_id = str(properties.get("id") or properties.get("@id") or "")
    selected = {key: str(tags[key]) for key in sorted(tags) if key in {"name", "amenity", "tourism", "leisure", "natural", "historic", "shop", "wheelchair", "surface", "access", "operator", "website"}}
    category = next((key for key in POI_ALLOWED if str(tags.get(key, "")) in POI_ALLOWED[key]), "other")
    return {
        "type": "Feature", "geometry": feature["geometry"],
        "properties": {"osm_type": osm_type, "osm_id": osm_id, "name": tags.get("name"), "category": category,
                       "state": state.id, "release_id": release, "source": "OpenStreetMap", "attribution": "© OpenStreetMap contributors",
                       "version": properties.get("version"), "timestamp": properties.get("timestamp"), "tags": selected},
    }


def build_state(
    state_value: str, release: str, root: Path, *, product: str = "roadway", source_url: str | None = None,
    source_sha256: str | None = None, publish_dir: Path | None = None, public_base_url: str | None = None,
    keep_source: bool = False, max_poi_candidates: int = 250_000,
    max_poi_extract_bytes: int = 256 * 1024 * 1024,
) -> dict[str, Any]:
    """Build, validate, then atomically catalog one state artifact."""
    if product not in {"roadway", "poi"}:
        raise ValueError("product must be roadway or poi")
    tools = require_tools("osmium", "tippecanoe", "pmtiles", "ogr2ogr")
    state = prepare_boundary(resolve_state(state_value), root)
    url = source_url or state.source_url
    if not url:
        raise BuildError(f"No default state-PBF provider mapping for {state.name}; pass --source-url.")
    release_dir = root / "releases" / release
    final_dir = release_dir / state.id
    artifact = final_dir / f"{product}.pmtiles"
    manifest_path = release_dir / "manifest.json"
    existing = _read_json(manifest_path, _empty_manifest(release))
    existing_item = existing.get("states", {}).get(state.id, {}).get(product)
    if artifact.exists() and existing_item and existing_item.get("sha256") == sha256_file(artifact) and validate_pmtiles(artifact)["valid"]:
        return {"status": "already_valid", "artifact": str(artifact.resolve()), "manifest": str(manifest_path.resolve()), "metadata": existing_item}

    source_path = root / "sources" / "osm" / f"{state.source_slug or state.code.lower()}.osm.pbf"
    source_meta_path = source_path.with_suffix(".source.json")
    if not source_path.exists():
        source_meta = download_file(url, source_path)
    else:
        source_meta = _read_json(source_meta_path, {"url": url, "bytes": source_path.stat().st_size, "sha256": sha256_file(source_path)})
    actual_source_hash = sha256_file(source_path)
    if source_sha256 and actual_source_hash.casefold() != source_sha256.casefold():
        raise BuildError(f"Source checksum mismatch: expected {source_sha256}, got {actual_source_hash}.")
    if url.startswith(GEOFABRIK_ROOT):
        checksum_request = urllib.request.Request(url + ".md5", headers={"User-Agent": "Gremlin-Lab-OSM-Builder/1.0"})
        try:
            with urllib.request.urlopen(checksum_request, timeout=60) as response:
                expected_md5 = response.read().decode("ascii", "replace").strip().split()[0].casefold()
        except OSError as exc:
            raise BuildError(f"Could not retrieve Geofabrik provider checksum for {url}: {exc}") from exc
        actual_md5 = hash_file(source_path, "md5")
        if expected_md5 != actual_md5:
            raise BuildError(f"Geofabrik MD5 mismatch: expected {expected_md5}, got {actual_md5}.")
        source_meta["providerChecksum"] = {"algorithm": "md5", "value": expected_md5, "verified": True, "url": url + ".md5"}
    source_meta["sha256"] = actual_source_hash
    source_meta["sourceDate"] = _osmium_source_date(str(tools["osmium"]["path"]), source_path) or source_meta.get("lastModified")
    atomic_json(source_meta_path, source_meta)

    work = root / "work" / release / state.id / product
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    clipped = work / "state.osm.pbf"
    filtered = work / f"{product}.osm.pbf"
    expressions = work / f"{product}.expressions"
    geojsonseq = work / f"{product}.geojsonseq"
    normalized = work / f"{product}.normalized.geojsonseq"
    mbtiles = work / f"{product}.mbtiles"
    staged = work / f"{product}.pmtiles"
    expressions.write_text("\n".join(ROADWAY_EXPRESSIONS if product == "roadway" else POI_EXPRESSIONS) + "\n", encoding="utf-8", newline="\n")

    started = datetime.now(timezone.utc)
    _run([str(tools["osmium"]["path"]), "extract", "--strategy", "smart", "-S", "types=multipolygon,route", "-S", "tags=route=foot,route=hiking,route=bicycle,leisure,natural,landuse", "-p", str(state.polygon_path), "-o", str(clipped), str(source_path)])
    _run([str(tools["osmium"]["path"]), "tags-filter", "--remove-tags", "--expressions", str(expressions), "-o", str(filtered), str(clipped)])
    if product == "poi" and filtered.stat().st_size > max_poi_extract_bytes:
        raise BuildError(f"Strict POI extract safety ceiling exceeded ({filtered.stat().st_size} bytes > {max_poi_extract_bytes}); narrow the allowlist before export.")
    _run([str(tools["osmium"]["path"]), "export", "-f", "geojsonseq", "-o", str(geojsonseq), str(filtered)])
    if product == "roadway":
        feature_count = _count_geojsonseq(geojsonseq)
        tile_input = geojsonseq
    else:
        feature_count = _normalize_geojsonseq(geojsonseq, normalized, state=state, release=release, product=product, maximum=max_poi_candidates)
        tile_input = normalized
    layer = "roadway" if product == "roadway" else "poi"
    _run([str(tools["tippecanoe"]["path"]), "--force", "--layer", layer, "--minimum-zoom", "5", "--maximum-zoom", "14", "--drop-densest-as-needed", "--extend-zooms-if-still-dropping", "-o", str(mbtiles), str(tile_input)])
    _run([str(tools["pmtiles"]["path"]), "convert", str(mbtiles), str(staged)])
    validation = validate_pmtiles(staged)
    if not validation["valid"]:
        raise BuildError(f"PMTiles validation failed: {validation['error']}")
    final_dir.mkdir(parents=True, exist_ok=True)
    os.replace(staged, artifact)
    artifact_hash = sha256_file(artifact)
    duration = (datetime.now(timezone.utc) - started).total_seconds()
    item: dict[str, Any] = {
        "available": True, "localAvailable": True, "cloudAvailable": False,
        "url": None, "path": f"{state.id}/{artifact.name}", "bytes": artifact.stat().st_size, "sha256": artifact_hash,
        "featureCount": feature_count, "sourceOsm": {**source_meta, "sha256": actual_source_hash},
        "builtAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "buildDurationSeconds": round(duration, 3), "pipelineVersion": PIPELINE_VERSION,
        "tools": {name: value["version"] for name, value in tools.items()},
    }
    manifest = _read_json(manifest_path, _empty_manifest(release))
    _ensure_catalog(root, manifest)
    state_entry = manifest["states"][state.id]
    state_entry[product] = item
    atomic_json(manifest_path, manifest)
    if publish_dir is not None:
        destination = publish_dir / release / state.id / artifact.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        shutil.copy2(artifact, temporary)
        if sha256_file(temporary) != artifact_hash:
            temporary.unlink(missing_ok=True)
            raise BuildError("Published copy checksum did not match local artifact.")
        os.replace(temporary, destination)
        item["cloudAvailable"] = True
        item["url"] = f"{public_base_url.rstrip('/')}/{release}/{state.id}/{artifact.name}" if public_base_url else str(destination.resolve())
        atomic_json(manifest_path, manifest)
    shutil.rmtree(work)
    if not keep_source:
        source_path.unlink(missing_ok=True)
        source_meta_path.unlink(missing_ok=True)
    return {"status": "built", "artifact": str(artifact.resolve()), "manifest": str(manifest_path.resolve()), "metadata": item}


def _normalize_geojsonseq(source: Path, destination: Path, *, state: StateMetadata, release: str, product: str, maximum: int) -> int:
    count = 0
    with source.open(encoding="utf-8") as incoming, destination.open("w", encoding="utf-8", newline="\n") as outgoing:
        for line in incoming:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feature = json.loads(line)
            if product == "poi":
                feature = normalize_poi_feature(feature, state=state, release=release)
                if feature is None:
                    continue
            outgoing.write(json.dumps(feature, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n")
            count += 1
            if product == "poi" and count > maximum:
                raise BuildError(f"Strict POI safety ceiling exceeded ({maximum} features); narrow the allowlist before tiling.")
    if count == 0:
        raise BuildError(f"The {product} filter produced zero usable features.")
    return count


def _count_geojsonseq(source: Path) -> int:
    count = 0
    with source.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip().lstrip("\x1e"):
                count += 1
    if count == 0:
        raise BuildError("The roadway filter produced zero usable features.")
    return count


def validate_pmtiles(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"valid": False, "error": "file does not exist", "path": str(path)}
    with path.open("rb") as stream:
        header = stream.read(8)
    if len(header) != 8 or header[:7] != b"PMTiles" or header[7] != 3:
        return {"valid": False, "error": "not a PMTiles v3 archive", "path": str(path), "bytes": path.stat().st_size}
    pmtiles = shutil.which("pmtiles")
    if pmtiles:
        verification = subprocess.run([pmtiles, "verify", str(path)], capture_output=True, text=True, check=False)
        if verification.returncode:
            return {"valid": False, "error": (verification.stderr or verification.stdout).strip() or "pmtiles verify failed", "path": str(path), "bytes": path.stat().st_size}
    return {"valid": True, "path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": sha256_file(path), "version": 3}


def validate_release(root: Path, release: str) -> dict[str, Any]:
    path = root / "releases" / release / "manifest.json"
    manifest = _read_json(path, None)
    if not isinstance(manifest, dict):
        return {"valid": False, "error": "manifest does not exist", "path": str(path)}
    errors: list[str] = []
    checked = 0
    for state_id, state in manifest.get("states", {}).items():
        for field in ("id", "code", "fips", "name", "bbox", "polygon"):
            if not state.get(field):
                errors.append(f"{state_id}: missing state field {field}")
        polygon = state.get("polygon") or {}
        for field in ("version", "sha256"):
            if not polygon.get(field):
                errors.append(f"{state_id}: missing Census polygon {field}")
        for product in ("roadway", "poi"):
            item = state.get(product)
            if not item or not item.get("localAvailable"):
                if item and item.get("cloudAvailable"):
                    _validate_cloud_manifest_item(errors, state_id, product, item)
                continue
            checked += 1
            result = validate_pmtiles(path.parent / item["path"])
            if not result["valid"] or result.get("sha256") != item.get("sha256"):
                errors.append(f"{state_id}/{product}: missing, invalid, or checksum mismatch")
            if result.get("bytes") != item.get("bytes"):
                errors.append(f"{state_id}/{product}: byte size mismatch")
            for field in ("featureCount", "buildDurationSeconds", "tools", "sourceOsm"):
                if item.get(field) is None:
                    errors.append(f"{state_id}/{product}: missing {field}")
            source = item.get("sourceOsm") or {}
            for field in ("url", "bytes", "sha256", "providerChecksum", "sourceDate"):
                if not source.get(field):
                    errors.append(f"{state_id}/{product}: missing source OSM {field}")
            if item.get("cloudAvailable"):
                _validate_cloud_manifest_item(errors, state_id, product, item)
    return {"valid": not errors, "artifactsChecked": checked, "errors": errors, "path": str(path.resolve())}


def _validate_cloud_manifest_item(errors: list[str], state_id: str, product: str, item: dict[str, Any]) -> None:
    for field in ("url", "objectPath", "uploadVerifiedAt"):
        if not item.get(field):
            errors.append(f"{state_id}/{product}: cloudAvailable without {field}")
    upload = item.get("upload") or {}
    if upload.get("status") != "verified":
        errors.append(f"{state_id}/{product}: cloudAvailable without verified upload status")
    if product in {"roadway", "poi"} and (not upload.get("rangeCompatible") or upload.get("rangeHttpStatus") != 206):
        errors.append(f"{state_id}/{product}: cloudAvailable without verified HTTP Range support")


def cleanup_state_inputs(state_value: str, root: Path, release: str) -> dict[str, Any]:
    """Delete source/intermediate state data only after every requested product validates."""
    state = resolve_state(state_value)
    removed: list[str] = []
    source = root / "sources" / "osm" / f"{state.source_slug or state.code.lower()}.osm.pbf"
    for path in (source, source.with_suffix(".source.json")):
        if path.exists():
            path.unlink()
            removed.append(str(path.resolve()))
    work = root / "work" / release / state.id
    if work.exists():
        shutil.rmtree(work)
        removed.append(str(work.resolve()))
    return {"state": state.id, "removed": removed}


def regenerate_manifest(root: Path, release: str) -> dict[str, Any]:
    """Validate existing entries and atomically remove false availability claims."""
    path = root / "releases" / release / "manifest.json"
    manifest = _read_json(path, _empty_manifest(release))
    _ensure_catalog(root, manifest)
    for state in manifest.get("states", {}).values():
        for product in ("roadway", "poi"):
            item = state.get(product)
            if item and item.get("localAvailable"):
                validation = validate_pmtiles(path.parent / item.get("path", ""))
                item["localAvailable"] = bool(validation["valid"] and validation.get("sha256") == item.get("sha256"))
                item["available"] = bool(item["localAvailable"] or item.get("cloudAvailable"))
    atomic_json(path, manifest)
    return manifest


def _empty_manifest(release: str) -> dict[str, Any]:
    return {"release": release, "schemaVersion": SCHEMA_VERSION, "pipelineVersion": PIPELINE_VERSION, "states": {}}


def _ensure_catalog(root: Path, manifest: dict[str, Any]) -> None:
    """Populate stable coverage entries while preserving validated products."""
    entries = manifest.setdefault("states", {})
    for configured in STATES.values():
        state = prepare_boundary(configured, root)
        current = entries.setdefault(state.id, {})
        current.update(state_public_dict(state))
        for product in ("roadway", "poi"):
            current.setdefault(product, {"available": False, "localAvailable": False, "cloudAvailable": False})


def _osmium_source_date(osmium: str, path: Path) -> str | None:
    result = subprocess.run([osmium, "fileinfo", "-g", "header.option.osmosis_replication_timestamp", str(path)], capture_output=True, text=True, check=False)
    value = result.stdout.strip()
    return value or None


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise BuildError(f"Command failed ({result.returncode}): {' '.join(command[:3])}\n{detail}")


def preflight_report() -> dict[str, Any]:
    tools = tool_inventory()
    guidance = {
        "osmium": "Install osmium-tool (Ubuntu/Debian: apt-get install osmium-tool).",
        "tippecanoe": "Install Tippecanoe from https://github.com/felt/tippecanoe (Linux/macOS; Docker is supported on Windows).",
        "tile-join": "Install Tippecanoe; tile-join is bundled by its build.",
        "pmtiles": "Install the Protomaps PMTiles CLI from https://github.com/protomaps/go-pmtiles/releases.",
        "ogr2ogr": "Install GDAL command-line tools.",
    }
    missing = [name for name, item in tools.items() if not item["path"]]
    return {"ready": not missing, "tools": tools, "missing": missing, "guidance": {name: guidance[name] for name in missing}}
