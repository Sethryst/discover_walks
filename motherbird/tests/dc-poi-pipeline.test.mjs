import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assignNeighborhoods, deduplicate, geometryContains, normalizeSource, validatePois } from '../tools/dc-pipeline/core.mjs';
import { geofenceCategoriesForCity, isOsmPoi, poiMatchesSelectedTags } from '../js/poi.js';
import { state } from '../js/state.js';

test('normalize converts source GeoJSON to the app POI contract', () => {
  const source = { id: 'test', title: 'Test', category: 'park', tags: ['park'], serviceUrl: 'https://example.com', nameFields: ['NAME'], descriptionFields: ['ADDRESS'] };
  const [poi] = normalizeSource(source, { features: [{ id: 7, geometry: { type: 'Point', coordinates: [-77, 38.9] }, properties: { NAME: 'Test Park', ADDRESS: '1 Main St' } }] });
  assert.equal(poi.name, 'Test Park'); assert.equal(poi.lat, 38.9); assert.equal(poi.lng, -77); assert.deepEqual(poi.tags, ['park']); assert.match(poi.id, /^dc-test-/);
});

test('a source can replace a numeric asset code with an honest visitor-facing label', () => {
  const source = { id: 'trail', title: 'Heritage Trail Signs', category: 'trail', tags: ['trail', 'history'], nameFields: ['NAME'], descriptionFields: [], nameForFeature: (properties) => `DC Heritage Trail sign ${properties.SIGN_NUMBER}` };
  const [poi] = normalizeSource(source, { features: [{ geometry: { type: 'Point', coordinates: [-77, 38.9] }, properties: { NAME: '12', SIGN_NUMBER: '18' } }] });
  assert.equal(poi.name, 'DC Heritage Trail sign 18');
});

test('neighborhood assignment uses polygon containment', () => {
  const geometry = { type: 'Polygon', coordinates: [[[-77.1, 38.8], [-76.9, 38.8], [-76.9, 39], [-77.1, 39], [-77.1, 38.8]]] };
  assert.equal(geometryContains([-77, 38.9], geometry), true);
  const [poi] = assignNeighborhoods([{ id: 'p', lat: 38.9, lng: -77 }], { features: [{ geometry, properties: { CLUSTER: 1, NAME: 'Downtown' } }] });
  assert.equal(poi.neighborhoodName, 'Downtown'); assert.equal(poi.neighborhoodClusterId, '1');
});

test('deduplication merges same-category same-name records within 50m', () => {
  const base = { category: 'park', name: 'The Sample Park', lat: 38.9, lng: -77 };
  const result = deduplicate([{ ...base, id: 'a' }, { ...base, id: 'b', lat: 38.9001 }]);
  assert.equal(result.pois.length, 1); assert.equal(result.report.merged, 1);
});

test('validation reports actionable record errors', () => {
  const result = validatePois([{ id: 'bad', name: '', category: 'park', tags: ['park'], lat: 0, lng: 0, source: 'x', retrievedAt: '2026-08-08', confidence: 'certain' }]);
  assert.equal(result.invalid.length, 1); assert.ok(result.invalid[0].errors.includes('coordinates outside configured DC boundary')); assert.ok(result.invalid[0].errors.includes('invalid confidence'));
});

test('missing coordinates fail instead of invoking nondeterministic geocoding', () => {
  const result = validatePois([{ id: 'no-location', name: 'Unknown place', category: 'park', tags: ['park'], source: 'x', retrievedAt: '2026-08-08', confidence: 'low', neighborhoodClusterId: '1', neighborhoodName: 'Test' }]);
  assert.equal(result.valid.length, 0); assert.ok(result.invalid[0].errors.includes('coordinates outside configured DC boundary'));
});

test('generated DC dataset passes the canonical validator', async () => {
  const json = JSON.parse(await readFile(new URL('../data/dc-poi.json', import.meta.url), 'utf8'));
  const checked = validatePois(json.pointsOfInterest || []);
  assert.ok(checked.valid.length >= 500); assert.deepEqual(checked.invalid, []);
});

test('OpenStreetMap source records can be filtered without making them geofence defaults', () => {
  const osmPoi = { id: 'osm:1', source: 'OpenStreetMap', tags: ['coffee'] };
  assert.equal(isOsmPoi(osmPoi), true); assert.equal(poiMatchesSelectedTags(osmPoi, new Set(['osm'])), true); assert.equal(poiMatchesSelectedTags(osmPoi, new Set(['park'])), false);
});

test('DC exposes every non-OSM POI category as a geofence setting', async () => {
  const data = JSON.parse(await readFile(new URL('../data/dc-poi.json', import.meta.url), 'utf8')).pointsOfInterest;
  const original = state.cityPois.dc; state.cityPois.dc = data;
  try { assert.deepEqual(geofenceCategoriesForCity('dc').map(([id]) => id), ['park', 'public_art', 'trail', 'history', 'wifi']); }
  finally { state.cityPois.dc = original; }
});
