#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Flatbush from 'flatbush';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SPATIAL_INDEX_SCHEMA_VERSION = 1;
export const FLATBUSH_LIBRARY_VERSION = '4.6.2';
export const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export function buildFlatbush(records, bboxForRecord) {
  if (!records.length) throw new Error('A Flatbush artifact cannot be built from zero records.');
  const index = new Flatbush(records.length);
  for (const record of records) {
    const bbox = bboxForRecord(record);
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value)) || bbox[0] > bbox[2] || bbox[1] > bbox[3]) {
      throw new Error(`Invalid bbox for spatial record ${record.id}.`);
    }
    index.add(...bbox);
  }
  index.finish();
  return Buffer.from(index.data);
}

export function geometryBbox(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let count = 0;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds[0] = Math.min(bounds[0], value[0]); bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]); bounds[3] = Math.max(bounds[3], value[1]); count += 1;
      return;
    }
    value.forEach(visit);
  };
  visit(geometry?.coordinates);
  if (!count) throw new Error('Boundary geometry has no valid positions.');
  return bounds;
}

export async function buildSpatialPackage({ regionId, configPath, outputPath, generatedAt }) {
  if (!regionId) throw new Error('regionId is required.');
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error('generatedAt must be an ISO-8601 timestamp.');
  const configFile = configPath || path.join(root, 'regions', regionId, 'spatial-index.json');
  const configPayload = await readFile(configFile);
  const config = JSON.parse(configPayload);
  if (config.schemaVersion !== SPATIAL_INDEX_SCHEMA_VERSION || config.regionId !== regionId) throw new Error(`${regionId}: incompatible spatial-index source configuration.`);

  const poiPath = path.resolve(root, config.poi.file);
  const poiPayload = await readFile(poiPath);
  const poiDocument = JSON.parse(poiPayload);
  const pois = (Array.isArray(poiDocument) ? poiDocument : poiDocument.pois || [])
    .filter((poi) => poi?.id && Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .map((poi) => ({ id: String(poi.id), lat: poi.lat, lng: poi.lng }))
    .sort((left, right) => left.id.localeCompare(right.id));
  rejectDuplicateIds(pois, 'POI');

  const boundaries = [];
  const boundaryInputs = [];
  for (const input of config.boundaries || []) {
    const inputPath = path.resolve(root, input.file);
    const payload = await readFile(inputPath);
    const document = JSON.parse(payload);
    if (document.type !== 'FeatureCollection' || !Array.isArray(document.features)) throw new Error(`${input.layer}: boundary source is not GeoJSON.`);
    for (const feature of document.features) {
      const sourceId = String(feature.properties?.boundary_id || feature.properties?.id || feature.id || '').trim();
      if (!sourceId) throw new Error(`${input.layer}: boundary feature has no stable ID.`);
      boundaries.push({ id: `${input.layer}:${sourceId}`, layer: input.layer, sourceId, bbox: geometryBbox(feature.geometry) });
    }
    boundaryInputs.push({ layer: input.layer, file: input.file, featureCount: document.features.length, checksum: sha256(payload) });
  }
  boundaries.sort((left, right) => left.id.localeCompare(right.id));
  rejectDuplicateIds(boundaries, 'boundary');

  const poiBinary = buildFlatbush(pois, (poi) => [poi.lng, poi.lat, poi.lng, poi.lat]);
  const boundaryBinary = buildFlatbush(boundaries, (boundary) => boundary.bbox);
  const poiIdsPayload = stableJson({ schemaVersion: 1, kind: 'poi-id-sidecar', ids: pois.map((poi) => poi.id) });
  const poiRecordFingerprint = sha256(runtimeFingerprintPayload(pois));
  const boundaryIdsPayload = stableJson({ schemaVersion: 1, kind: 'boundary-id-sidecar', records: boundaries.map(({ id, layer, sourceId }) => ({ id, layer, sourceId })) });
  const output = outputPath || path.join(root, 'regions', regionId, 'spatial');
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'pois.flatbush'), poiBinary),
    writeFile(path.join(output, 'pois.ids.json'), poiIdsPayload),
    writeFile(path.join(output, 'boundaries.flatbush'), boundaryBinary),
    writeFile(path.join(output, 'boundaries.ids.json'), boundaryIdsPayload)
  ]);

  const manifest = {
    schemaVersion: SPATIAL_INDEX_SCHEMA_VERSION,
    artifactType: 'regional-spatial-index-package',
    regionId,
    generatedAt,
    provider: { name: 'flatbush', libraryVersion: FLATBUSH_LIBRARY_VERSION, serializedFormatVersion: 3, nodeSize: 16 },
    coordinateOrder: 'minLng,minLat,maxLng,maxLat',
    semantics: { role: 'candidate-prefilter-only', exactGeometryRequired: true, ordinalIdentity: false },
    inputs: {
      config: { file: path.relative(root, configFile).replaceAll('\\', '/'), checksum: sha256(configPayload) },
      poi: { file: config.poi.file, checksum: sha256(poiPayload), featureCount: pois.length },
      boundaries: boundaryInputs
    },
    indexes: {
      pois: { binary: 'pois.flatbush', ids: 'pois.ids.json', featureCount: pois.length, recordFingerprint: poiRecordFingerprint, binaryChecksum: sha256(poiBinary), idsChecksum: sha256(poiIdsPayload) },
      boundaries: { binary: 'boundaries.flatbush', ids: 'boundaries.ids.json', featureCount: boundaries.length, binaryChecksum: sha256(boundaryBinary), idsChecksum: sha256(boundaryIdsPayload) }
    },
    replay: `node tools/build-spatial-index.mjs ${regionId} --generated-at ${generatedAt}`
  };
  await writeFile(path.join(output, 'spatial-index-manifest.json'), stableJson(manifest));
  return manifest;
}

function rejectDuplicateIds(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`Duplicate ${label} stable ID: ${record.id}.`);
    seen.add(record.id);
  }
}

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const runtimeFingerprintPayload = (records) => records.map(({ id, lng, lat }) => JSON.stringify([String(id), lng, lat])).sort().join('\n') + '\n';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const regionId = args[0] && !args[0].startsWith('--') ? args[0] : 'washington-dc';
  const generatedAtIndex = args.indexOf('--generated-at');
  const generatedAt = generatedAtIndex >= 0 ? args[generatedAtIndex + 1] : process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString();
  const manifest = await buildSpatialPackage({ regionId, generatedAt });
  console.log(`Spatial package ${regionId}: pois=${manifest.indexes.pois.featureCount}, boundaries=${manifest.indexes.boundaries.featureCount}, provider=flatbush.`);
}
