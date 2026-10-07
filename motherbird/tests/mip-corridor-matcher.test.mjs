import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorridorReport, buildEdgeFeatureSidecar, matchFlowlineAdjacency, matchOfficialCorridor, PILOT_BBOX } from '../tools/mip-corridor-matcher.mjs';

const graphEdges = [
  { id: 'edge-1', from: 1, to: 2, coordinates: [[-77.2, 38.8], [-77.19, 38.8]], lengthMeters: 870 },
  { id: 'edge-2', from: 2, to: 3, coordinates: [[-77.19, 38.8], [-77.18, 38.8]], lengthMeters: 870 }
];

test('official line matching is deterministic and reports verified evidence', () => {
  const result = matchOfficialCorridor({ id: 'wod-trail', name: 'W&OD Trail', sourceId: 'official-wod', coordinates: [[-77.2, 38.80001], [-77.18, 38.80001]] }, graphEdges, { bbox: PILOT_BBOX });
  assert.equal(result.id, 'wod-trail');
  assert.deepEqual(result.quality.matchedEdgeIds, ['edge-1', 'edge-2']);
  assert.equal(result.status, 'verified');
  assert.ok(result.quality.coverageFraction >= 0.8);
});

test('flowline adjacency is not trail alignment', () => {
  const result = matchFlowlineAdjacency({ id: 'difficult-run', name: 'Difficult Run', coordinates: [[-77.2, 38.8004], [-77.18, 38.8004]] }, graphEdges, { bbox: PILOT_BBOX, minMeters: 30, maxMeters: 75 });
  assert.equal(result.label, 'creek-adjacent');
  assert.match(result.quality.note, /not trail alignment/);
});

test('corridor report sorts records and keeps status counts explicit', () => {
  const report = buildCorridorReport([{ id: 'z', status: 'rejected' }, { id: 'a', status: 'verified' }], { graphVersion: 'g1', cellId: 'cell-1', routingRelease: 'r1' });
  assert.deepEqual(report.corridors.map((corridor) => corridor.id), ['a', 'z']);
  assert.deepEqual(report.summary, { total: 2, verified: 1, candidate: 0, rejected: 1 });
});

test('unmatched official samples fail closed instead of crashing', () => {
  const result = matchOfficialCorridor({ id: 'partial', coordinates: [[-77.2, 38.8], [-77.1, 38.8]] }, [graphEdges[0]]);
  assert.equal(result.status, 'rejected');
  assert.ok(result.quality.matchedSampleCount < result.quality.sampleCount);
});

test('sidecar emits only verified edge evidence with stable metadata and checksum', () => {
  const corridor = { id: 'wod', name: 'W&OD', status: 'verified', sourceIds: ['official:wod'], sourceUrl: 'https://example.test/wod', signals: ['greenway'], quality: { matchedEdgeIds: ['e2', 'e1'], matchedLengthMeters: 200, confidence: .9 } };
  const sidecar = buildEdgeFeatureSidecar({ corridors: [corridor, { id: 'candidate', status: 'candidate', quality: { matchedEdgeIds: ['bad'] } }], graphVersion: 'g1', cellId: 'c1', routingRelease: 'r1', sourceManifest: 'manifest.json' });
  assert.deepEqual(sidecar.edges.map((edge) => edge.edgeId), ['e1', 'e2']);
  assert.equal(sidecar.corridorReferences.length, 1);
  assert.match(sidecar.checksum, /^fnv1a-[0-9a-f]{8}$/);
  assert.equal(sidecar.graphVersion, 'g1');
});
