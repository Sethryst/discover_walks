import test from 'node:test';
import assert from 'node:assert/strict';
import { getPoisInNeighborhood, getPoisNearRoute, reindexSpatialData, spatialIndexStatus } from '../js/spatial-index.js';

const pois = [
  { id: 'inside', name: 'Inside Garden', lat: 38.90, lng: -77.02 },
  { id: 'corridor', name: 'Route Museum', lat: 38.905, lng: -77.01 },
  { id: 'far', name: 'Far Place', lat: 38.96, lng: -77.08 }
];
const neighborhoods = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'n-1', properties: { id: 'n-1', name: 'Fixture' }, geometry: { type: 'Polygon', coordinates: [[[-77.04, 38.88], [-77.04, 38.92], [-77.00, 38.92], [-77.00, 38.88], [-77.04, 38.88]]] } }] };

test('static grid indexes installed POIs and neighborhood polygons', () => {
  reindexSpatialData('dc', pois, neighborhoods);
  assert.deepEqual(getPoisInNeighborhood('n-1').map((poi) => poi.id), ['corridor', 'inside']);
  assert.equal(spatialIndexStatus().neighborhoods, 1);
});

test('route corridor query filters candidates by actual segment distance', () => {
  reindexSpatialData('dc', pois, neighborhoods);
  const results = getPoisNearRoute([[38.89, -77.01], [38.91, -77.01]], 130);
  assert.deepEqual(results.map(({ poi }) => poi.id), ['corridor']);
});
