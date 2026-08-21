import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'research', 'appalachian-corridor-lab', '2026-08-20');
const required = [
  'centerline-segment-v20260820.geojson',
  'official-parking-inventory-v20260820.json',
  'access-evidence-seed-v20260820.json',
  'candidate-window-endpoints-v20260820.geojson',
  'poi-family-policy-v20260820.md',
  'source-health-matrix-v20260820.json',
  'event-volunteer-feasibility-v20260820.md',
  'README.md'
];
const json = async (name) => JSON.parse(await readFile(path.join(dir, name), 'utf8'));

test('upstream research package contains every mandated, versioned artifact', async () => {
  await Promise.all(required.map((name) => access(path.join(dir, name))));
});

test('research geometry fixes screening precision without becoming promotion evidence', async () => {
  const centerline = await json('centerline-segment-v20260820.geojson');
  const parking = await json('official-parking-inventory-v20260820.json');
  const access = await json('access-evidence-seed-v20260820.json');
  const endpoints = await json('candidate-window-endpoints-v20260820.geojson');
  assert.ok(centerline.metadata.vertexCount > 4000);
  assert.equal(parking.records.length, 10);
  assert.equal(new Set(parking.records.map((record) => record.objectId)).size, parking.records.length);
  assert.ok(parking.records.every((record) => record.distanceToCenterlineMeters < 500));
  assert.ok(access.records.every((record) => record.evidenceGrade === 'research-grade' && !record.editorSigned));
  assert.ok(endpoints.features.every((feature) => feature.properties.publishingState === 'candidate' && feature.properties.reviewRequired));
});

test('source health and time-sensitive content preserve blockers', async () => {
  const health = await json('source-health-matrix-v20260820.json');
  const overpass = health.sources.find((source) => source.name.includes('Overpass'));
  const feasibility = await readFile(path.join(dir, 'event-volunteer-feasibility-v20260820.md'), 'utf8');
  assert.equal(overpass.status, 406);
  assert.equal(overpass.healthy, false);
  assert.match(feasibility, /Parser not ready — keep source-only/);
});
