import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcGisClient } from '../tools/federal-core/arcgis-client.mjs';
import { fetchAdaptiveLayer, planAdaptiveTiles } from '../tools/federal-core/adaptive-tiles.mjs';
import { compileLayer } from '../tools/federal-core/artifact-contract.mjs';
import { writeTiledArtifact } from '../tools/federal-core/tiled-artifact-writer.mjs';
import { inspectSourceContract } from '../tools/federal-core/source-contract.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ok = (payload) => ({ ok: true, status: 200, statusText: 'OK', json: async () => payload });

test('ArcGIS transport gets all IDs first and fetches every deterministic batch', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = Object.fromEntries(options.body || []);
    requests.push({ url, method: options.method, body });
    if (body.returnIdsOnly === 'true') return ok({ objectIdFieldName: 'OBJECTID', objectIds: [3, 1, 2] });
    const ids = body.objectIds.split(',');
    return ok({
      type: 'FeatureCollection',
      features: ids.map((id) => ({ type: 'Feature', id: Number(id), properties: { OBJECTID: Number(id) }, geometry: { type: 'Point', coordinates: [Number(id), 0] } }))
    });
  };
  const client = new ArcGisClient({ fetchImpl, retries: 0 });
  const result = await client.completeQuery('https://example.test/MapServer/0', { batchSize: 2 }, 'states');
  assert.deepEqual(result.features.map((feature) => feature.properties.OBJECTID), [1, 2, 3]);
  assert.deepEqual(result.stats, { method: 'object-id-batches', objectIdCount: 3, batchCount: 2 });
  assert.equal(requests.every((request) => request.method === 'POST'), true);
  assert.deepEqual(requests.slice(1).map((request) => request.body.objectIds), ['1,2', '3']);
});

test('ArcGIS transport refuses an incomplete object-ID batch', async () => {
  const fetchImpl = async (_url, options) => {
    const body = Object.fromEntries(options.body || []);
    if (body.returnIdsOnly === 'true') return ok({ objectIds: [1, 2] });
    return ok({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 1, properties: { OBJECTID: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } }] });
  };
  const client = new ArcGisClient({ fetchImpl, retries: 0 });
  await assert.rejects(() => client.completeQuery('https://example.test/MapServer/0'), /incomplete object-ID batch/);
});

test('ArcGIS transport isolates a provider failure by recursively splitting the batch', async () => {
  const requestedBatches = [];
  const fetchImpl = async (_url, options) => {
    const body = Object.fromEntries(options.body || []);
    if (body.returnIdsOnly === 'true') return ok({ objectIds: [1, 2, 3, 4] });
    const ids = body.objectIds.split(',');
    requestedBatches.push(ids);
    if (ids.length > 2) return { ok: false, status: 500, statusText: 'geometry batch too large', json: async () => ({}) };
    return ok({
      type: 'FeatureCollection',
      features: ids.map((id) => ({ type: 'Feature', properties: { OBJECTID: Number(id) }, geometry: { type: 'Point', coordinates: [0, 0] } }))
    });
  };
  const client = new ArcGisClient({ fetchImpl, retries: 0 });
  const result = await client.completeQuery('https://example.test/MapServer/0', { batchSize: 4 });
  assert.equal(result.features.length, 4);
  assert.deepEqual(requestedBatches, [['1', '2', '3', '4'], ['1', '2'], ['3', '4']]);
});

test('adaptive tile planner subdivides only dense envelopes', async () => {
  const counts = new Map([
    ['0,0,4,4', 4],
    ['0,0,2,2', 1],
    ['2,0,4,2', 1],
    ['0,2,2,4', 0],
    ['2,2,4,4', 2]
  ]);
  const client = { count: async (_service, { envelope }) => counts.get(envelope.join(',')) };
  const plan = await planAdaptiveTiles(client, { id: 'fema', service: 'service' }, [0, 0, 4, 4], { maxFeaturesPerTile: 2 });
  assert.deepEqual(plan.leaves.map((tile) => [tile.key, tile.count]), [['0.0', 1], ['0.1', 1], ['0.3', 2]]);
  assert.equal(plan.countQueries, 5);
});

test('adaptive FEMA acquisition deduplicates polygons that cross tile edges', async () => {
  const client = {
    count: async (_service, { envelope }) => envelope[2] - envelope[0] === 4 ? 3 : envelope[1] === 0 ? 2 : 0,
    objectIds: async (_service, { envelope }) => envelope[0] === 0 ? ['1', '2'] : ['2', '3'],
    featuresByIds: async (_service, ids) => ids.map((id) => ({ id, properties: { OBJECTID: Number(id) } }))
  };
  const source = { id: 'fema-nfhl', service: 'service', objectIdField: 'OBJECTID' };
  const result = await fetchAdaptiveLayer(client, source, [0, 0, 4, 4], { maxFeaturesPerTile: 2, batchSize: 2 });
  assert.deepEqual(result.features.map((feature) => feature.id).sort(), ['1', '2', '3']);
  assert.equal(result.stats.tileObjectIdCount, 4);
  assert.equal(result.stats.uniqueObjectIdCount, 3);
  assert.equal(result.stats.duplicateTileHitsRemoved, 1);
});

test('artifact compiler keeps transport details behind the stable boundary contract', () => {
  const source = {
    id: 'fema-nfhl', adapter: 'fema-nfhl-tiled', boundaryType: 'floodplain', classification: 'contextual_risk',
    authority: 'FEMA', service: 'service', vintage: 'NFHL-current', idField: 'FLD_AR_ID', nameField: 'FLD_ZONE'
  };
  const raw = [{
    type: 'Feature',
    properties: { OBJECTID: 9, FLD_AR_ID: 'district_9', FLD_ZONE: 'AE' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 0]]] }
  }];
  const artifact = compileLayer(source, 'dc', '2026-08-20T00:00:00.000Z', raw, { method: 'test' });
  const properties = artifact.features[0].properties;
  assert.equal(properties.boundary_id, 'fema_floodplain_NFHL-current_district_9');
  assert.equal(properties.classification, 'contextual_risk');
  assert.deepEqual(properties.bbox, [0, 0, 2, 1]);
  assert.match(properties.geometry_hash, /^sha256:[a-f0-9]{64}$/);
});

test('national FEMA writer emits bounded-memory shards and an explicit edge policy', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'federal-core-tiles-'));
  const client = {
    count: async () => 1,
    objectIds: async () => ['9'],
    featuresByIds: async () => [{
      type: 'Feature', properties: { OBJECTID: 9, FLD_AR_ID: 'area_9', FLD_ZONE: 'AE' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    }]
  };
  const source = {
    id: 'fema-nfhl', adapter: 'fema-nfhl-tiled', service: 'service', authority: 'FEMA', vintage: 'NFHL-current',
    boundaryType: 'floodplain', classification: 'contextual_risk', idField: 'FLD_AR_ID', nameField: 'FLD_ZONE',
    objectIdField: 'OBJECTID', maxFeaturesPerTile: 10, maxTileDepth: 2, batchSize: 5,
    scopeEnvelopes: { national: [0, 0, 2, 2] }, scopeQueries: { national: '1=1' }
  };
  try {
    const descriptor = await writeTiledArtifact(client, source, 'national', '2026-08-20T00:00:00.000Z', output);
    const index = JSON.parse(await readFile(path.join(output, descriptor.filename), 'utf8'));
    assert.equal(descriptor.format, 'adaptive-tiled-geojson-index');
    assert.equal(index.tiles.length, 1);
    assert.equal(index.tiling.installDeduplicationKey, 'boundary_id');
    assert.match(index.tiles[0].checksum, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('source contract stops a silent provider-vintage change', async () => {
  const client = {
    layerMetadata: async () => ({
      name: 'States', description: 'January 1, 2026 vintage', currentVersion: 11.5,
      capabilities: 'Map,Query,Data', supportedQueryFormats: 'JSON, geoJSON',
      fields: [{ name: 'GEOID' }, { name: 'NAME' }, { name: 'OBJECTID' }],
      advancedQueryCapabilities: { supportsPagination: true }
    })
  };
  const source = {
    id: 'states', service: 'service', idField: 'GEOID', nameField: 'NAME',
    expectedDescriptionIncludes: 'January 1, 2025 vintage'
  };
  await assert.rejects(() => inspectSourceContract(client, source), /provider vintage changed/);
});
