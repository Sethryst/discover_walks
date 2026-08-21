import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../regions/washington-dc/geography/${name}`, import.meta.url), 'utf8').then(JSON.parse);
test('DC civic boundary package is schema-versioned, complete, and source-backed', async () => {
  const manifest = await read('boundary-manifest.json');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourcePolicy.runtimeNetworkAccess, false);
  assert.deepEqual(Object.fromEntries(manifest.layers.map((layer) => [layer.id, layer.featureCount])), { wards: 8, ancs: 40, 'police-districts': 7 });
  assert.ok(manifest.featureCountTrend.length >= 1);
  for (const layer of manifest.layers) assert.match(layer.checksum, /^sha256:[a-f0-9]{64}$/);
});
test('enrichment only claims point membership and produces an offline index', async () => {
  const [manifest, index, enriched, aggregates] = await Promise.all([read('boundary-manifest.json'), read('boundaries-indexed.json'), read('pois-with-boundaries.json'), read('aggregates-by-boundary.json')]);
  assert.match(manifest.enrichment.method, /point-in-polygon/);
  assert.equal(index.artifactType, 'boundary-bbox-index');
  assert.equal(index.layers.wards.length, 8);
  assert.ok(enriched.pois.length >= 500);
  assert.equal(aggregates.aggregationMethod, 'POI point membership; no areal weighting');
});
