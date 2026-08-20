import assert from 'node:assert/strict';
import test from 'node:test';
import { CURATED_ROUTES, validateRoute } from '../js/routes.js';

test('Anacostia East Bank becomes eight named, independently usable official GIS walks', () => {
  const routes = CURATED_ROUTES.filter((item) => item.id.startsWith('dc-anacostia-river-trail-east-bank-section-'));
  assert.equal(routes.length, 8, 'the long corridor becomes a useful set of eight walks');
  assert.ok(routes.every((route) => route.geometryProvenance.type === 'official-gis'));
  assert.ok(routes.every((route) => route.geometryProvenance.sourceRecordId === '55'));
  assert.ok(routes.every((route) => route.distanceMiles >= 0.2 && route.distanceMiles <= 0.4), 'each section reports its geometry-derived distance honestly');
  assert.ok(routes.every((route) => route.title.includes('·') && route.coordinates.length >= 2), 'each section has a proximity label and renderable geometry');
  assert.ok(routes.every((route) => validateRoute(route).valid));
});
