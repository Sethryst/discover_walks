import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorridorReport, matchFlowlineAdjacency, matchOfficialCorridor, PILOT_BBOX } from '../tools/mip-corridor-matcher.mjs';

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
