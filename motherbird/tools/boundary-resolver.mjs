import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

async function exists(file) { try { await access(file); return true; } catch { return false; } }

function geometryFrom(value) {
  if (value?.type === 'Feature') return value.geometry;
  if (value?.type === 'FeatureCollection') {
    if (value.features.length !== 1) throw new Error('Boundary GeoJSON FeatureCollection must contain exactly one feature');
    return value.features[0].geometry;
  }
  return value;
}

function validateGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('Boundary must be a GeoJSON Polygon or MultiPolygon');
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let coordinateCount = 0;
  for (const polygon of polygons) for (const ring of polygon) {
    if (!Array.isArray(ring) || ring.length < 4) throw new Error('Every boundary ring needs at least four positions');
    for (const position of ring) {
      if (!Array.isArray(position) || !isNumber(position[0]) || !isNumber(position[1]) || position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90) {
        throw new Error('Boundary contains an invalid longitude/latitude position');
      }
      coordinateCount += 1;
    }
  }
  if (coordinateCount < 4) throw new Error('Boundary has no coordinates');
  return geometry;
}

export function bboxForGeometry(geometry) {
  const positions = geometry.type === 'Polygon' ? geometry.coordinates.flat(1) : geometry.coordinates.flat(2);
  const lons = positions.map((point) => point[0]);
  const lats = positions.map((point) => point[1]);
  return { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
}

/** Resolve a configured boundary into a standalone GeoJSON Feature for osmium.
 * Supported sources: authoritative-geojson (downloaded and cached), cache-file,
 * and explicit (geometry embedded in region.json). */
export async function resolveBoundary(boundary, { root, cacheDir }) {
  if (!boundary?.source) throw new Error('boundary.source is required; bbox-only boundaries are not supported');
  let raw;
  let sourceDescription;
  if (boundary.source === 'explicit') {
    raw = boundary.geometry;
    sourceDescription = 'explicit configuration';
  } else if (boundary.source === 'cache-file') {
    if (!boundary.file) throw new Error('cache-file boundary requires boundary.file');
    raw = JSON.parse(await readFile(path.resolve(root, boundary.file), 'utf8'));
    sourceDescription = `cached file ${boundary.file}`;
  } else if (boundary.source === 'authoritative-geojson') {
    if (!boundary.url || !boundary.cacheFile) throw new Error('authoritative-geojson boundary requires url and cacheFile');
    const cached = path.resolve(root, boundary.cacheFile);
    if (await exists(cached)) raw = JSON.parse(await readFile(cached, 'utf8'));
    else {
      const response = await fetch(boundary.url, { headers: { Accept: 'application/geo+json, application/json' } });
      if (!response.ok) throw new Error(`Boundary download failed: ${response.status} ${response.statusText}`);
      raw = await response.json();
      await mkdir(path.dirname(cached), { recursive: true });
      await writeFile(cached, JSON.stringify(raw));
    }
    sourceDescription = `authoritative GeoJSON ${boundary.url}`;
  } else throw new Error(`Unsupported boundary.source '${boundary.source}'`);

  const geometry = validateGeometry(geometryFrom(raw));
  const feature = { type: 'Feature', properties: { source: boundary.source }, geometry };
  await mkdir(cacheDir, { recursive: true });
  const polygonFile = path.join(cacheDir, 'boundary.geojson');
  await writeFile(polygonFile, JSON.stringify(feature));
  return { geometry, bbox: bboxForGeometry(geometry), polygonFile, sourceDescription };
}
