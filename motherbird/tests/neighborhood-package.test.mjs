import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('installed DC neighborhood package retains producer contract and checksum', async () => {
  const payload = await readFile(new URL('../regions/washington-dc/geography/neighborhoods.geojson', import.meta.url));
  const source = JSON.parse(await readFile(new URL('../regions/washington-dc/geography/source.json', import.meta.url), 'utf8'));
  const artifact = JSON.parse(payload);
  assert.equal(artifact.metadata.regionId, 'washington-dc');
  assert.equal(artifact.metadata.layerRole, 'neighborhood_boundaries');
  assert.equal(artifact.features.length, 46);
  assert.ok(artifact.features.every((feature) => feature.properties.id && feature.properties.name));
  assert.equal(`sha256:${createHash('sha256').update(payload).digest('hex')}`, source.checksum);
});
