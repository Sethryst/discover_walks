import test from 'node:test';
import assert from 'node:assert/strict';
import { WalkingCellRegistry } from '../js/walking-cell-registry.js';
import { fetchArtifact, opfsPath } from '../js/walking-cell-cache.js';
import { buildPersonalEdgeScores, routeCostWithPersonalScore } from '../js/personal-edge-scores.js';

const manifest = {
  format: 'motherbird-walking-cell-registry-v1', release: '2026-09', cells: [
    { id: 'broad', bounds: [-78, 38, -76, 40], artifacts: { map: { url: './broad.pmtiles' }, graph: { url: './broad.json' } } },
    { id: 'fine', bounds: [-77.2, 38.7, -76.8, 39.1], artifacts: { map: { url: './national.pmtiles', range: { offset: 100, length: 50 } }, graph: { url: './fine.json' } } }
  ]
};

test('registry selects the smallest matching cell entirely on-device', () => {
  const registry = new WalkingCellRegistry(manifest, 'https://static.example/releases/cells.json');
  assert.equal(registry.find(38.9, -77).id, 'fine');
  assert.equal(registry.find(39.5, -77).id, 'broad');
  assert.equal(registry.find(0, 0), null);
  assert.equal(registry.cells[1].artifacts.map.url, 'https://static.example/releases/national.pmtiles');
});

test('range fetch omits credentials/location and rejects a full archive response', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(new Uint8Array(50), { status: 206 }); };
  const artifact = new WalkingCellRegistry(manifest, 'https://static.example/cells.json').cells[1].artifacts.map;
  await fetchArtifact(fetchImpl, artifact);
  assert.equal(calls[0].init.headers.get('Range'), 'bytes=100-149');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  await assert.rejects(() => fetchArtifact(async () => new Response(new Uint8Array(50), { status: 200 }), artifact), /did not honor/);
});

test('OPFS paths are release/cell scoped and personal scores do not mutate topology', () => {
  assert.equal(opfsPath('2026-09', 'fine', 'graph'), 'walking-cells/2026-09/fine/routing-graph.json');
  const edges = Object.freeze(['a', 'b']);
  const scores = buildPersonalEdgeScores(edges, { walks: [{ edgeIds: ['a'] }], observations: [{ edgeId: 'a' }], audioNotes: [{ edgeId: 'b' }] });
  assert.deepEqual(scores.get('a'), { edgeId: 'a', visits: 1, observations: 1, audioNotes: 0, score: 3 });
  assert.deepEqual(edges, ['a', 'b']);
  assert.ok(routeCostWithPersonalScore(100, scores.get('a'), 1) < 100);
});
