#!/usr/bin/env node
// DC's civic layer is deliberately separate from OSM.  These are authoritative
// boundaries, built once into offline artifacts; no map interaction calls a GIS
// service at runtime.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'regions', 'washington-dc', 'geography');
const now = new Date().toISOString();
const arcgisQuery = (service, fields) => `${service}/query?where=1%3D1&outFields=${encodeURIComponent(fields)}&returnGeometry=true&outSR=4326&f=geojson`;
const layers = [
  { id: 'wards', role: 'ward_boundaries', file: 'wards.geojson', min: 8, source: 'DC Office of Planning / DC GIS', url: arcgisQuery('https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_APPS/PropertyQuest/MapServer/35', 'WARD,NAME,WARD_ID,GIS_ID'), key: (p) => p.WARD_ID || p.WARD, name: (p) => p.NAME },
  // This service currently exposes the 2013 ANC geometry.  The manifest makes
  // that effective era explicit rather than implying it is a current election map.
  { id: 'ancs', role: 'anc_boundaries', file: 'ancs.geojson', min: 40, source: 'DC GIS / DC Board of Elections', url: arcgisQuery('https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/1', 'NAME,ANC_ID,GIS_ID'), key: (p) => p.ANC_ID || p.GIS_ID, name: (p) => p.NAME, effectiveFrom: '2013-01-01' },
  { id: 'police-districts', role: 'police_district_boundaries', file: 'police-districts.geojson', min: 7, source: 'Metropolitan Police Department / DC GIS', url: arcgisQuery('https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/9', 'NAME,DISTRICT,POLICEDISTRICT,GLOBALID'), key: (p) => p.POLICEDISTRICT || p.DISTRICT || p.GLOBALID, name: (p) => p.NAME, effectiveFrom: '2019-01-10' }
];

const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const stable = (value) => JSON.stringify(value);
const positions = (geometry) => geometry.type === 'Polygon' ? geometry.coordinates.flat(1) : geometry.coordinates.flat(2);
function bbox(geometry) { const points = positions(geometry); return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]; }
function containsRing([x, y], ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
function contains(point, geometry) { const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates; return polygons.some(([outer, ...holes]) => containsRing(point, outer) && !holes.some((hole) => containsRing(point, hole))); }
function pointForPoi(poi) { return Number.isFinite(poi?.lng) && Number.isFinite(poi?.lat) ? [poi.lng, poi.lat] : null; }
function compactFeature(feature, layer) { const props = feature.properties || {}; const id = String(layer.key(props)); const name = String(layer.name(props) || id); if (!id || id === 'undefined' || !name || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) throw new Error(`${layer.id} has an invalid boundary feature`); return { type: 'Feature', id, properties: { id, name, sourceId: layer.id, effectiveFrom: layer.effectiveFrom || null }, geometry: feature.geometry }; }
function countBy(items, key) { return Object.fromEntries(Object.entries(items.reduce((acc, item) => { const value = key(item) || 'unassigned'; acc[value] = (acc[value] || 0) + 1; return acc; }, {})).sort(([a], [b]) => a.localeCompare(b))); }

await mkdir(destination, { recursive: true });
const priorPath = path.join(destination, 'boundary-manifest.json');
let prior = null; try { prior = JSON.parse(await readFile(priorPath, 'utf8')); } catch { /* first snapshot */ }
const normalized = {};
for (const layer of layers) {
  const response = await fetch(layer.url, { headers: { Accept: 'application/geo+json', 'User-Agent': 'MotherBird-boundary-builder/1.0' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${layer.id} source returned ${response.status}`);
  const raw = await response.json();
  if (raw.type !== 'FeatureCollection' || raw.features.length < layer.min) throw new Error(`${layer.id} expected at least ${layer.min} features; received ${raw.features?.length || 0}`);
  const features = raw.features.map((feature) => compactFeature(feature, layer)).sort((a, b) => a.id.localeCompare(b.id));
  const artifact = { type: 'FeatureCollection', metadata: { schemaVersion: 1, artifactType: 'civic-boundary-layer', regionId: 'washington-dc', layerRole: layer.role, source: { provider: 'dcgis-arcgis', name: layer.source, url: layer.url }, effectiveFrom: layer.effectiveFrom || null, generatedAt: now }, features };
  const payload = `${JSON.stringify(artifact, null, 2)}\n`;
  normalized[layer.id] = { layer, artifact, payload, featureFingerprints: Object.fromEntries(features.map((feature) => [feature.id, sha(stable({ geometry: feature.geometry, properties: feature.properties }))])) };
}

const poiDocument = JSON.parse(await readFile(path.join(root, 'data', 'dc-poi.json'), 'utf8'));
const pois = poiDocument.pointsOfInterest || [];
const enriched = pois.map((poi) => {
  const point = pointForPoi(poi); const contexts = {};
  for (const [id, packageData] of Object.entries(normalized)) {
    const hit = point && packageData.artifact.features.find((feature) => contains(point, feature.geometry));
    contexts[id] = hit ? { id: hit.id, name: hit.properties.name } : null;
  }
  return { ...poi, civicBoundaries: contexts };
});
const aggregate = {};
for (const [id, packageData] of Object.entries(normalized)) {
  aggregate[id] = packageData.artifact.features.map((feature) => {
    const members = enriched.filter((poi) => poi.civicBoundaries[id]?.id === feature.id);
    return { id: feature.id, name: feature.properties.name, poiCount: members.length, categories: countBy(members, (poi) => poi.category) };
  });
}
const index = { schemaVersion: 1, artifactType: 'boundary-bbox-index', regionId: 'washington-dc', generatedAt: now, query: 'Filter by bbox, then perform point-in-polygon against the named layer.', layers: Object.fromEntries(Object.entries(normalized).map(([id, packageData]) => [id, packageData.artifact.features.map((feature) => ({ id: feature.id, bbox: bbox(feature.geometry) }))])) };
const fingerprints = Object.fromEntries(Object.entries(normalized).map(([id, data]) => [id, data.featureFingerprints]));
const changeSet = Object.fromEntries(Object.entries(fingerprints).map(([id, next]) => { const previous = prior?.featureFingerprints?.[id] || {}; return { added: Object.keys(next).filter((key) => !previous[key]).length, removed: Object.keys(previous).filter((key) => !next[key]).length, changed: Object.keys(next).filter((key) => previous[key] && previous[key] !== next[key]).length }; }));
const featureCounts = Object.fromEntries(Object.entries(normalized).map(([id, data]) => [id, data.artifact.features.length]));
const priorTrend = prior?.featureCountTrend || [];
const featureCountTrend = [...priorTrend.slice(-29), { generatedAt: now, counts: featureCounts }];
const manifest = { schemaVersion: 1, artifactType: 'civic-boundary-manifest', regionId: 'washington-dc', generatedAt: now, cadence: { fastPath: 'daily', slowPath: 'weekly', note: 'DC is tier 1; a failed source must retain the prior verified artifact rather than ship an empty layer.' }, sourcePolicy: { runtimeNetworkAccess: false, provider: 'dcgis-arcgis', osmRole: 'none — civic boundaries are authoritative government data' }, schemaCompatibility: { minimumReaderVersion: 1, cachePolicy: 'Readers must reject an unknown schemaVersion and refresh the package.' }, layers: Object.values(normalized).map(({ layer, artifact, payload }) => ({ id: layer.id, filename: layer.file, role: layer.role, featureCount: artifact.features.length, checksum: sha(payload), sourceUrl: layer.url, effectiveFrom: layer.effectiveFrom || null })), featureFingerprints: fingerprints, featureChanges: changeSet, featureCountTrend, enrichment: { filename: 'pois-with-boundaries.json', method: 'point-in-polygon for point POIs only', limitation: 'Polygon/line overlap weighting is intentionally not claimed in v1.' }, index: { filename: 'boundaries-indexed.json', format: 'JSON bbox prefilter + GeoJSON point-in-polygon', binaryFlatbuffer: 'deferred until a versioned FlatBuffers schema is adopted' } };
await Promise.all([
  ...Object.values(normalized).map(({ layer, payload }) => writeFile(path.join(destination, layer.file), payload)),
  writeFile(path.join(destination, 'pois-with-boundaries.json'), `${JSON.stringify({ schemaVersion: 1, regionId: 'washington-dc', generatedAt: now, poiSchemaVersion: poiDocument.metadata?.version || null, pois: enriched }, null, 2)}\n`),
  writeFile(path.join(destination, 'aggregates-by-boundary.json'), `${JSON.stringify({ schemaVersion: 1, regionId: 'washington-dc', generatedAt: now, aggregationMethod: 'POI point membership; no areal weighting', layers: aggregate }, null, 2)}\n`),
  writeFile(path.join(destination, 'boundaries-indexed.json'), `${JSON.stringify(index, null, 2)}\n`),
  writeFile(priorPath, `${JSON.stringify(manifest, null, 2)}\n`)
]);
console.log(`DC civic boundary artifacts: ${featureCounts.wards} wards, ${featureCounts.ancs} ANCs, ${featureCounts['police-districts']} police districts; enriched ${enriched.length} POIs.`);
