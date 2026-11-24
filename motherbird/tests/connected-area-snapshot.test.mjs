import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConnectedAreaSnapshot, collectSnapshotPoints, deriveCoverageArea, summarizeSnapshotPois } from '../js/connected-area-snapshot.js';

const p = (id, lat, lng, extra = {}) => ({ id, location: { lat, lng }, ...extra });

test('collects automatic points and selected stops without inventing records', () => {
  const points = collectSnapshotPoints({ automaticUserPoints: [p('a', 1, 1)], selectedStops: [p('b', 2, 2), p('a-duplicate', 1, 1), { id: 'bad', location: { lat: 99, lng: 1 } }] });
  assert.deepEqual(points.map((point) => point.id), ['a', 'b']);
});

test('connects consecutive points only from returned route geometry', async () => {
  const points = collectSnapshotPoints({ automaticUserPoints: [p('a', 0, 0)], selectedStops: [p('b', 1, 1), p('c', 2, 2)] });
  const legs = await (await import('../js/connected-area-snapshot.js')).connectSnapshotPoints(points, { routeOnFoot: async ([from, to]) => ({ ok: true, coordinates: [[from.lat, from.lng], [0.5, 0.5], [to.lat, to.lng]] }) });
  assert.equal(legs.length, 2); assert.equal(legs[0].coordinates.length, 3);
});

test('failed routing produces no straight-line geometry', async () => {
  const snapshot = await buildConnectedAreaSnapshot({ automaticUserPoints: [p('a', 0, 0)], selectedStops: [p('b', 1, 1)], routeOnFoot: async () => ({ ok: false, status: 'NO_ROUTE' }) });
  assert.equal(snapshot.legs[0].coordinates.length, 0); assert.equal(snapshot.coverageArea.coordinates.length, 0); assert.equal(snapshot.connected, false);
});

test('coverage area and POI/outlink summary use only verified route vertices', () => {
  const area = deriveCoverageArea([{ ok: true, coordinates: [[0, 0], [0, 2], [2, 2]] }]);
  assert.equal(area.invisible, true); assert.equal(area.type, 'Polygon');
  const summary = summarizeSnapshotPois([p('inside', 0.5, 0.5, { category: 'park', sourceUrl: 'https://example.test/a' }), p('outside', 5, 5, { category: 'museum', sourceUrl: 'https://outside.test' })], area);
  assert.deepEqual(summary.categories, { park: 1 }); assert.equal(summary.outlinkCount, 1); assert.deepEqual(summary.outlinkDomains, { 'example.test': 1 });
});

test('driving fallback metadata is preserved and counted separately', async () => {
  const snapshot = await buildConnectedAreaSnapshot({ automaticUserPoints: [p('a', 0, 0)], selectedStops: [p('b', 1, 1)], routeOnFoot: async () => ({ ok: true, drivingFallback: true, transportationMode: 'driving', coordinates: [[0, 0], [0.2, 0.2], [1, 1]] }) });
  assert.equal(snapshot.routeSummary.drivingFallbackLegCount, 1); assert.equal(snapshot.routeSummary.walkingLegCount, 0); assert.equal(snapshot.legs[0].drivingFallback, true);
});

