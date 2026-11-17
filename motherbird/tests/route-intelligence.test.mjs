import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoveryOpportunities, buildRouteCorridor, clusterGeographicObjects, interestMatch, normalizeTransportationMode, spatialRelationship } from '../js/route-intelligence.js';

const route = { id: 'commute', transportationMode: 'driving', coordinates: [[38.90, -77.04], [38.91, -77.04]] };

test('corridor preserves transportation mode and uses mode-specific scale', () => {
  const corridor = buildRouteCorridor(route);
  assert.equal(corridor.transportationMode, 'driving');
  assert.equal(corridor.radiusMeters, 2400);
  assert.equal(corridor.provenance.routeId, 'commute');
});

test('unsupported transportation modes normalize without blocking discovery', () => {
  assert.equal(normalizeTransportationMode('scooter'), 'other');
  assert.equal(normalizeTransportationMode('cycling'), 'cycling');
  assert.equal(buildRouteCorridor({ coordinates: [[38.9, -77.04], [38.91, -77.04]] }).transportationMode, 'walking');
});

test('interest matching supports intersections instead of independent filters', () => {
  const result = interestMatch({ category: 'historic bridge', tags: ['river', 'water'] }, ['history', 'water']);
  assert.deepEqual(result.matches, ['history', 'water']);
  assert.equal(result.score, 1);
});

test('discoveries remain opportunities and explain route relationships', () => {
  const results = buildDiscoveryOpportunities({ route, interests: ['history', 'water'], exploredIds: [], objects: [{ id: 'bridge', name: 'Old bridge', category: 'historic', tags: ['bridge', 'river'], lat: 38.905, lng: -77.04 }] });
  assert.equal(results.length, 1);
  assert.equal(results[0].unexplored, true);
  assert.match(results[0].explanation, /History \+ Water/);
  assert.equal(results[0].relatedRouteId, 'commute');
});

test('geometry relationships support non-point objects through coordinate geometry', () => {
  const result = spatialRelationship({ geometry: { type: 'LineString', coordinates: [[-77.04, 38.90], [-77.04, 38.91]] } }, { lat: 38.905, lng: -77.04 });
  assert.equal(result.type, 'overlaps');
  assert.ok(result.distanceMeters < 1);
});

test('overlapping geometry is distinct from merely nearby geometry', () => {
  const result = spatialRelationship(
    { geometry: { type: 'LineString', coordinates: [[-77.04, 38.90], [-77.04, 38.91]] } },
    { geometry: { type: 'LineString', coordinates: [[-77.04, 38.905], [-77.04, 38.915]] } }
  );
  assert.equal(result.type, 'overlaps');
  assert.equal(result.distanceMeters, 0);
});

test('clusters combine nearby points and line or polygon-like geometries', () => {
  const clusters = clusterGeographicObjects([
    { id: 'trail', geometry: { type: 'LineString', coordinates: [[-77.04, 38.90], [-77.04, 38.91]] } },
    { id: 'park', geometry: { type: 'Polygon', coordinates: [[[-77.041, 38.904], [-77.039, 38.904], [-77.039, 38.906], [-77.041, 38.906]]] } },
    { id: 'far', lat: 39.1, lng: -77.2 }
  ], { nearMeters: 250 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters.find((cluster) => cluster.size === 2)?.members.map((item) => item.id).sort().join(','), 'park,trail');
});
