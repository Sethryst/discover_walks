import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FlatbushPackageIndex, createGridIndex } from '../js/spatial-index-providers.js';
import { loadFlatbushPackage } from '../js/spatial-package-loader.js';
import { buildSpatialPackage } from '../tools/build-spatial-index.mjs';
import { getPoisInNeighborhood, reindexSpatialData, spatialIndexStatus, upgradeSpatialDataFromPackage } from '../js/spatial-index.js';

const root = path.resolve(import.meta.dirname, '..');
const spatialRoot = path.join(root, 'regions', 'washington-dc', 'spatial');
const readJson = (filename) => readFile(path.join(spatialRoot, filename), 'utf8').then(JSON.parse);
const exactBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const digest = (buffer) => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;

async function loadFixture() {
  const [manifest, poiDocument, ids, binary] = await Promise.all([
    readJson('spatial-index-manifest.json'),
    readFile(path.join(root, 'regions', 'washington-dc', 'washington-dc-poi.json'), 'utf8').then(JSON.parse),
    readJson('pois.ids.json'),
    readFile(path.join(spatialRoot, 'pois.flatbush'))
  ]);
  const records = poiDocument.pois;
  return { manifest, records, ids, binary, flatbush: new FlatbushPackageIndex({ data: exactBuffer(binary), ids: ids.ids, records, expectedCount: manifest.indexes.pois.featureCount }) };
}

test('published spatial package binds binaries to stable IDs and source versions', async () => {
  const manifest = await readJson('spatial-index-manifest.json');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.semantics.role, 'candidate-prefilter-only');
  assert.equal(manifest.semantics.exactGeometryRequired, true);
  assert.equal(manifest.semantics.ordinalIdentity, false);
  for (const index of Object.values(manifest.indexes)) {
    const [binary, sidecar] = await Promise.all([readFile(path.join(spatialRoot, index.binary)), readFile(path.join(spatialRoot, index.ids))]);
    assert.equal(digest(binary), index.binaryChecksum);
    assert.equal(digest(sidecar), index.idsChecksum);
  }
});

test('Flatbush and grid providers return identical candidate IDs', async () => {
  const { records, flatbush } = await loadFixture();
  const grid = createGridIndex(records);
  for (let index = 0; index < 100; index += 1) {
    const west = -77.12 + (index % 10) * 0.02;
    const south = 38.79 + Math.floor(index / 10) * 0.02;
    const bbox = [west, south, west + 0.035, south + 0.035];
    const ids = (provider) => provider.searchBbox(...bbox).map((record) => record.id).sort();
    assert.deepEqual(ids(flatbush), ids(grid), `provider mismatch for ${bbox.join(',')}`);
  }
});

test('offline loader verifies and activates both packaged indexes', async () => {
  const { records } = await loadFixture();
  const fetchImpl = fileFetch();
  const loaded = await loadFlatbushPackage('/spatial', records, { fetchImpl, cryptoImpl: webcrypto });
  assert.equal(loaded.poiIndex.status().records, 1436);
  assert.equal(loaded.boundaryIndex.status().records, 101);
  assert.equal(loaded.boundaryIndex.searchBbox(-77.04, 38.88, -77.00, 38.92).every((record) => record.layer), true);
});

test('runtime upgrades behind the existing API without changing exact neighborhood results', async () => {
  const { records } = await loadFixture();
  const neighborhoods = JSON.parse(await readFile(path.join(root, 'regions', 'washington-dc', 'geography', 'neighborhoods.geojson')));
  const neighborhoodId = String(neighborhoods.features[0].properties?.id || neighborhoods.features[0].id);
  reindexSpatialData('dc', records, neighborhoods);
  const gridResult = getPoisInNeighborhood(neighborhoodId).map((record) => record.id);
  const result = await upgradeSpatialDataFromPackage('dc', records, neighborhoods, '/spatial', { fetchImpl: fileFetch(), cryptoImpl: webcrypto });
  assert.equal(result.provider, 'flatbush-package');
  assert.equal(spatialIndexStatus().syncIdentity.poiVersion, 'dc-pois-2026-08-20');
  assert.equal(spatialIndexStatus().boundaryRecords, 101);
  assert.deepEqual(getPoisInNeighborhood(neighborhoodId).map((record) => record.id), gridResult);
});

test('runtime retains the grid when package verification fails', async () => {
  const { records } = await loadFixture();
  const result = await upgradeSpatialDataFromPackage('dc', records, null, '/spatial', { fetchImpl: fileFetch({ corruptPoi: true }), cryptoImpl: webcrypto });
  assert.equal(result.provider, 'grid');
  assert.match(result.fallbackReason, /checksum mismatch/);
  assert.equal(spatialIndexStatus().provider, 'composite');
  assert.equal(spatialIndexStatus().baseProvider, 'grid');
});

test('runtime retains the grid when mutable records are not in the static package', async () => {
  const { records } = await loadFixture();
  const withDelta = [...records, { id: 'session-only-place', lat: 38.9, lng: -77.03 }];
  const result = await upgradeSpatialDataFromPackage('dc', withDelta, null, '/spatial', { fetchImpl: fileFetch(), cryptoImpl: webcrypto });
  assert.equal(result.provider, 'grid');
  assert.match(result.fallbackReason, /coordinate fingerprint|record count differs/);
  assert.equal(spatialIndexStatus().records, withDelta.length);
});

test('runtime retains the grid when coordinates drift without an ID change', async () => {
  const { records } = await loadFixture();
  const changed = records.map((record, index) => index === 0 ? { ...record, lng: record.lng + 0.01 } : record);
  const result = await upgradeSpatialDataFromPackage('dc', changed, null, '/spatial', { fetchImpl: fileFetch(), cryptoImpl: webcrypto });
  assert.equal(result.provider, 'grid');
  assert.match(result.fallbackReason, /coordinate fingerprint checksum mismatch/);
});

test('offline loader rejects corrupt binaries and unknown schemas', async () => {
  const { records } = await loadFixture();
  await assert.rejects(() => loadFlatbushPackage('/spatial', records, { fetchImpl: fileFetch({ corruptPoi: true }), cryptoImpl: webcrypto }), /checksum mismatch/);
  await assert.rejects(() => loadFlatbushPackage('/spatial', records, { fetchImpl: fileFetch({ schemaVersion: 999 }), cryptoImpl: webcrypto }), /Unsupported spatial index schema/);
});

test('same source and timestamp produce byte-identical spatial packages', async () => {
  const first = await mkdtemp(path.join(tmpdir(), 'spatial-index-a-'));
  const second = await mkdtemp(path.join(tmpdir(), 'spatial-index-b-'));
  const options = { regionId: 'washington-dc', configPath: path.join(root, 'regions', 'washington-dc', 'spatial-index.json'), generatedAt: '2026-08-20T20:08:46.710Z' };
  try {
    await buildSpatialPackage({ ...options, outputPath: first });
    await buildSpatialPackage({ ...options, outputPath: second });
    const files = (await readdir(first)).sort();
    assert.deepEqual(files, (await readdir(second)).sort());
    for (const filename of files) assert.deepEqual(await readFile(path.join(first, filename)), await readFile(path.join(second, filename)), filename);
  } finally {
    await Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]);
  }
});

test('DC Flatbush candidate lookup stays within a conservative local budget', async () => {
  const { flatbush } = await loadFixture();
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) flatbush.searchBbox(-77.05, 38.88, -77.00, 38.93);
  const elapsed = performance.now() - started;
  console.log(`DC Flatbush: 10,000 bbox searches in ${elapsed.toFixed(2)}ms (guardrail: 1,000ms)`);
  assert.ok(elapsed < 1_000);
});

function fileFetch({ corruptPoi = false, schemaVersion } = {}) {
  return async (url) => {
    const filename = String(url).split('/').pop();
    try {
      let body = await readFile(path.join(spatialRoot, filename));
      if (filename === 'pois.flatbush' && corruptPoi) { body = Buffer.from(body); body[10] ^= 0xff; }
      if (filename === 'spatial-index-manifest.json' && schemaVersion !== undefined) {
        const manifest = JSON.parse(body); manifest.schemaVersion = schemaVersion; body = Buffer.from(JSON.stringify(manifest));
      }
      return new Response(body, { status: 200, headers: filename.endsWith('.json') ? { 'Content-Type': 'application/json' } : {} });
    } catch {
      return new Response('missing', { status: 404 });
    }
  };
}
