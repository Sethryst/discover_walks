import assert from 'node:assert/strict';
import test from 'node:test';
import { compactRouteCollections, CURATED_ROUTES, routesForCity, validateRoute } from '../js/routes.js';
import { state } from '../js/state.js';

test('Anacostia East Bank becomes eight named, independently usable official GIS walks', () => {
  const routes = CURATED_ROUTES.filter((item) => item.id.startsWith('dc-anacostia-river-trail-east-bank-section-'));
  assert.equal(routes.length, 8, 'the long corridor becomes a useful set of eight walks');
  assert.ok(routes.every((route) => route.geometryProvenance.type === 'official-gis'));
  assert.ok(routes.every((route) => route.geometryProvenance.sourceRecordId === '55'));
  assert.ok(routes.every((route) => route.distanceMiles >= 0.2 && route.distanceMiles <= 0.4), 'each section reports its geometry-derived distance honestly');
  assert.ok(routes.every((route) => route.title.includes('·') && route.coordinates.length >= 2), 'each section has a proximity label and renderable geometry');
  assert.ok(routes.every((route) => validateRoute(route).valid));
});

test('Anacostia short stretches are presented as one compact, expandable collection', () => {
  state.activeCity = 'dc';
  const routes = routesForCity('dc').filter((route) => route.collection === 'Anacostia River Trail: East Bank');
  assert.equal(routes.length, 8);
  assert.ok(routes.every((route) => route.durationMinutes <= 10), 'each choice remains a short companion walk');
});

test('DC featured corridor set stays source-backed and compact by default', () => {
  const collections = new Set(CURATED_ROUTES.filter((route) => route.city === 'dc').map((route) => route.collection));
  assert.ok(collections.size >= 12, 'the DC companion includes a broad, source-backed set of recognizable corridors');
  assert.ok(CURATED_ROUTES.filter((route) => route.city === 'dc').every((route) => route.geometryProvenance?.type === 'official-gis'));
});

test('route compaction stays bounded for an extremely large corridor', () => {
  const sections = Array.from({ length: 500 }, (_, index) => ({
    id: `very-long-trail-${index + 1}`,
    collection: 'Very Long Trail',
    sectionNumber: index + 1,
    durationMinutes: 15,
    distanceMiles: 0.75
  }));
  const compacted = compactRouteCollections(sections);
  assert.equal(compacted.length, 1, 'one corridor consumes one list card before a walker expands it');
  assert.equal(compacted[0].routes.length, 500);
});
