import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateRouteFeatures, composeVerifiedLegs, detectUTurn, scoreMIPRoute, validateEdgeFeatureSidecar } from '../js/mip-features.js';

const route = { ok: true, graphVersion: 'g1', cellId: 'c1', cellRelease: 'r1', edgeIds: ['e1', 'e2', 'e2'], durationSeconds: 900, directDurationMinutes: 10, stops: [{ id: 'poi-1' }] };
const sidecar = {
  schemaVersion: 1, graphVersion: 'g1', cellId: 'c1', routingRelease: 'r1', checksum: 'ok',
  edges: [
    { edgeId: 'e1', lengthMeters: 100, confidence: .9, corridorRefs: [{ id: 'wod', signals: ['greenway'] }], sourceIds: ['osm:e1'] },
    { edgeId: 'e2', lengthMeters: 80, confidence: .8, signals: { quiet: 1 }, sourceIds: ['osm:e2'] }
  ]
};

test('sidecar validation fails closed on graph, release, and checksum mismatch', () => {
  assert.deepEqual(validateEdgeFeatureSidecar(sidecar, { graphVersion: 'g1', cellId: 'c1', routingRelease: 'r1' }), { valid: true });
  assert.equal(validateEdgeFeatureSidecar(sidecar, { graphVersion: 'old' }).reason, 'GRAPH_VERSION_MISMATCH');
  assert.equal(validateEdgeFeatureSidecar({ ...sidecar, checksumValid: false }).reason, 'CHECKSUM_INVALID');
});

test('aggregation counts unique route edges and ignores candidate corridors', () => {
  const features = aggregateRouteFeatures(route, sidecar, [], [{ id: 'wod', status: 'verified', sourceIds: ['official:wod'] }, { id: 'candidate', status: 'candidate' }]);
  assert.deepEqual(features.corridorIds, ['wod']);
  assert.equal(features.edgeCount, 2);
  assert.deepEqual(features.sourceProvenanceIds, ['official:wod', 'osm:e1', 'osm:e2']);
  const ignored = aggregateRouteFeatures(route, sidecar, [], [{ id: 'wod', status: 'candidate' }]);
  assert.deepEqual(ignored.corridorIds, []);
});

test('weights change ranking only and hard feasibility remains authoritative', () => {
  const features = aggregateRouteFeatures(route, sidecar, [], [{ id: 'wod', status: 'verified' }]);
  assert.equal(scoreMIPRoute(route, features, 'discovery', { maxMinutes: 20 }).feasible, true);
  assert.equal(scoreMIPRoute(route, features, 'discovery', { maxMinutes: 10 }).feasible, false);
  assert.equal(scoreMIPRoute({ ...route, accessibilityVerified: false }, features, 'accessible_verified').feasible, false);
});

test('leg composition preserves exact points, edge sequence, metadata, and detects a short U-turn spur', () => {
  const composed = composeVerifiedLegs([
    { ok: true, geometry: { coordinates: [[1, 2], [2, 3]] }, edge_ids: ['a'], distance_m: 10, estimated_duration_s: 8, graph_version: 'g1', release: 'r1' },
    { ok: true, geometry: { coordinates: [[2, 3], [3, 4]] }, edge_ids: ['b'], distance_m: 11, estimated_duration_s: 9, graph_version: 'g1', release: 'r1' }
  ], { vias: [{ id: 'via-1' }] });
  assert.deepEqual(composed.coordinates, [[1, 2], [2, 3], [3, 4]]);
  assert.deepEqual(composed.edgeIds, ['a', 'b']);
  assert.equal(composed.hasUTurn, false);
  assert.equal(detectUTurn(['a', 'b', 'a']), true);
});
