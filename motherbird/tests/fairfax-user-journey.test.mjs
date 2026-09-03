import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { CITIES } from '../js/constants.js';
import { routeEvidence, routeExplanation } from '../js/planner.js';

const appRoot = path.resolve(import.meta.dirname, '..');

test('a Fairfax visitor can select a local package with official civic meetings', async () => {
  assert.equal(CITIES.fairfax.name, 'Fairfax County');
  const civic = JSON.parse(await readFile(path.join(appRoot, 'regions/fairfax-county-va/civic/index.json'), 'utf8'));
  const meetings = civic.artifacts.meetings.items;
  assert.ok(meetings.length > 0);
  assert.ok(meetings.every((meeting) => meeting.date && meeting.locationLabel && /^https:\/\//.test(meeting.officialUrl)));
});

test('the sketch shows supplied comfort evidence without inferring accessibility or shade', async () => {
  const base = { distanceMeters: 1000, coordinates: [[38.84, -77.3], [38.85, -77.31]] };
  const accessible = { ...base, stops: [{ id: 'sidewalk', surface: 'CONCRETE', width: '6', stairs: '0', accessibility: { ada: 'Yes' } }] };
  const stairs = { ...base, stops: [{ id: 'stairs', surface: 'DIRT', stairs: '12' }] };
  assert.deepEqual(routeEvidence(accessible), { restrooms: 0, drinkingWater: 0 });
  assert.deepEqual(routeEvidence({ ...base, stops: [{ tags: ['restrooms'], drinkingWater: true }] }), { restrooms: 1, drinkingWater: 1 });
  assert.doesNotMatch(routeExplanation(accessible).join(' '), /stair-free|canopy|shaded|accessible/i);
  assert.doesNotMatch(routeExplanation(stairs).join(' '), /stair-free|canopy|shaded|accessible/i);
});

test('Fairfax keeps surfaced trail geometry in edges and comfort evidence in real pins', async () => {
  const data = JSON.parse(await readFile(path.join(appRoot, 'regions/fairfax-county-va/pois.json'), 'utf8'));
  const network = JSON.parse(await readFile(path.join(appRoot, 'regions/fairfax-county-va/edges.json'), 'utf8'));
  assert.ok(network.edges.some((edge) => edge.name && edge.surface && edge.officialUrl && edge.geometry?.coordinates?.length > 1));
  assert.ok(data.pois.some((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng) && (poi.restrooms || poi.drinkingWater)));
});
