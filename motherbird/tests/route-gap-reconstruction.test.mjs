import test from 'node:test';
import assert from 'node:assert/strict';
import { gapBetween, reconstructedDistance, reconstructedPoints } from '../js/route-gap-reconstruction.js';

const from = { lat: 38.9, lng: -77.1, capturedAt: '2026-10-08T12:00:00.000Z' };
const to = { lat: 38.91, lng: -77.09, capturedAt: '2026-10-08T12:05:00.000Z' };

test('only material timestamp gaps are eligible for graph reconstruction', () => {
  assert.equal(gapBetween(from, to), true);
  assert.equal(gapBetween(from, { ...to, capturedAt: '2026-10-08T12:00:30.000Z' }), false);
});

test('reconstructed points are explicitly inferred and time-bounded', () => {
  const coordinates = [[from.lat, from.lng], [38.905, -77.095], [to.lat, to.lng]];
  const points = reconstructedPoints(coordinates, from, to);
  assert.equal(points.length, 1);
  assert.equal(points[0].inferred, true);
  assert.equal(points[0].source, 'route-graph');
  assert.equal(points[0].capturedAt, '2026-10-08T12:02:30.000Z');
  assert.ok(reconstructedDistance(coordinates) > 0);
});
