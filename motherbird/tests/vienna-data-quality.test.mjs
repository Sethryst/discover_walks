import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { availablePoiTags } from '../js/poi.js';
import { validateRoute } from '../js/routes.js';

test('Vienna church uses its verified Orchard Street location', async () => {
  const data = JSON.parse(await readFile(new URL('../data/vienna-poi.json', import.meta.url)));
  const church = data.pointsOfInterest.find((poi) => poi.id === 'vienna-first-baptist');
  assert.deepEqual([church.lat, church.lng], [38.899983, -77.2768474]);
  assert.match(church.source, /fbcv\.org/);
});

test('Vienna OSM supplement provides usable filter categories', async () => {
  const data = JSON.parse(await readFile(new URL('../data/osm/vienna-osm-poi.json', import.meta.url)));
  assert.ok(data.pois.length >= 20);
  const tags = availablePoiTags(data.pois).map(([id]) => id);
  for (const tag of ['coffee', 'park', 'library', 'nature']) assert.ok(tags.includes(tag), `${tag} should be filterable`);
});

test('zero-coordinate journeys cannot be previewed as routes', () => {
  assert.equal(validateRoute({ isJourney: true, coordinates: [[0, 0], [0, 0]] }).valid, false);
});

