import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { CITIES } from '../js/constants.js';
import { objectiveCost, ROUTE_OBJECTIVES, routeEvidence } from '../js/planner.js';

const appRoot = path.resolve(import.meta.dirname, '..');

test('a Fairfax visitor can select a local package with official civic meetings', async () => {
  assert.equal(CITIES.fairfax.name, 'Fairfax County');
  const civic = JSON.parse(await readFile(path.join(appRoot, 'regions/fairfax-county-va/civic/index.json'), 'utf8'));
  const meetings = civic.artifacts.meetings.items;
  assert.ok(meetings.length > 0);
  assert.ok(meetings.every((meeting) => meeting.date && meeting.locationLabel && /^https:\/\//.test(meeting.officialUrl)));
});

test('accessible ranking favors a paved, stair-free route without claiming real canopy shade', async () => {
  const base = { distanceMeters: 1000, coordinates: [[38.84, -77.3], [38.85, -77.31]] };
  const accessible = { ...base, stops: [{ id: 'sidewalk', surface: 'CONCRETE', width: '6', stairs: '0', accessibility: { ada: 'Yes' } }] };
  const stairs = { ...base, stops: [{ id: 'stairs', surface: 'DIRT', stairs: '12' }] };
  assert.ok(objectiveCost(accessible, 'accessible') < objectiveCost(stairs, 'accessible'));
  assert.deepEqual(routeEvidence(accessible), { accessibleSegments: 1, adaPlaces: 1, restrooms: 0, drinkingWater: 0 });
  assert.match(ROUTE_OBJECTIVES.find((item) => item.key === 'shade').note, /not installed/i);
});

test('the published Fairfax package includes user-visible sidewalk and comfort evidence', async () => {
  const data = JSON.parse(await readFile(path.join(appRoot, 'regions/fairfax-county-va/pois.json'), 'utf8'));
  assert.ok(data.pois.some((poi) => poi.category === 'trail' && poi.surface && poi.width));
  assert.ok(data.pois.some((poi) => poi.category === 'facility' && (poi.restrooms || poi.drinkingWater)));
});
