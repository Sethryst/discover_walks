import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { CITIES } from '../js/constants.js';
import { onboardingProgress, onboardingValue } from '../js/onboarding.js';
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
  assert.equal(onboardingProgress([], 'region'), 1);
  assert.equal(onboardingProgress([], 'interests'), 1);
  assert.equal(onboardingProgress(['park'], 'interests'), 2);
  assert.equal(onboardingProgress(['park'], 'ready'), 3);
  assert.equal(onboardingValue('Loudoun County', ['park', 'trail']), 'Your first Discover Walks view in Loudoun County will prioritize green space and wildlife and trails.');
});

test('onboarding asks only for region, while Start Walk begins tracking immediately', async () => {
  const events = await readFile(path.join(root, 'js/events.js'), 'utf8');
  assert.match(events, /await startWalk\(\{ routeMode: 'tracking' \}\)/);
  assert.doesNotMatch(events, /onboardingRegionNextButton.*setOnboardingStep\('interests'\)/);
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /Use my location instead/);
  assert.match(html, /id="activeWalkMode"/);
  assert.match(html, /value="round-trip">Round trip/);
});

test('first launch does not request GPS until the walker chooses it in onboarding', async () => {
  const loader = await readFile(path.join(root, 'js/loader.js'), 'utf8');
  assert.doesNotMatch(loader, /nearestCityFromCurrentLocation/);
});
