import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { CITIES } from '../js/constants.js';
import { onboardingValue } from '../js/onboarding.js';
import { routesForCity, validateRoute } from '../js/routes.js';
import { state } from '../js/state.js';

const root = path.resolve(import.meta.dirname, '..');

test('a new walker can choose Loudoun and open a verified official GIS route', async () => {
  assert.equal(CITIES.loudoun.name, 'Loudoun County');
  const packageData = JSON.parse(await readFile(path.join(root, 'regions/loudoun-county-va/journeys.json'), 'utf8'));
  state.cityPois.loudoun = packageData.journeys.map((journey) => ({ ...journey, category: 'journey' }));
  const [route] = routesForCity('loudoun');
  assert.ok(route.coordinates.length >= 20);
  assert.ok(route.distanceMiles > 0.5);
  assert.equal(validateRoute(route).valid, true);
  assert.match(route.access.note, /not yet been verified/i);
  assert.match(route.sources[0].url, /^https:\/\/logis\.loudoun\.gov/);
});

test('onboarding turns region and interests into an immediate first action', () => {
  assert.equal(onboardingValue('Loudoun County', ['park', 'trail']), 'We’ll open Loudoun County with green space and wildlife and trails ready to explore.');
});
