import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (name) => readFile(new URL(`../federal-core/artifacts/dc/${name}`, import.meta.url), 'utf8').then(JSON.parse);
test('Federal Core separates standardized TIGER artifacts from municipal packs', async () => {
  const manifest = await read('producer-manifest.json');
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.sourcePolicy.municipalSources, 'plugins-only');
  assert.equal(manifest.sourcePolicy.runtimeNetworkAccess, false);
  assert.deepEqual(manifest.artifacts.map((item) => item.id), ['states', 'counties', 'congressional-districts', 'fema-nfhl']);
  assert.deepEqual(manifest.unavailableLayers, []);
  assert.equal(manifest.completeness, 'complete-for-declared-layers');
});
test('FEMA is a separate contextual-risk artifact with tiled acquisition provenance', async () => {
  const fema = await read('fema-nfhl.geojson');
  assert.ok(fema.features.length > 0);
  assert.equal(fema.metadata.acquisition.method, 'adaptive-envelope-tiles-plus-object-id-batches');
  assert.equal(fema.features[0].properties.classification, 'contextual_risk');
  assert.match(fema.features[0].properties.boundary_id, /^fema_floodplain_/);
});
test('Federal boundary records carry a complete provenance identity', async () => {
  const counties = await read('counties.geojson'); const record = counties.features[0].properties;
  for (const key of ['boundary_id', 'boundary_type', 'geometry_hash', 'bbox', 'source_authority', 'source_url', 'vintage', 'provider_version', 'schema_version', 'classification']) assert.ok(record[key]);
  assert.match(record.boundary_id, /^tiger_county_/);
});
