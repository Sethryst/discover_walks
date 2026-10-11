import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateStops, objectiveCost, routeExplanation } from '../js/planner.js';
import { state } from '../js/state.js';
import { readFile } from 'node:fs/promises';

const plannerSource = await readFile(new URL('../js/planner.js', import.meta.url), 'utf8');

test('the single-sketch planner reports distance without inventing green or shade scores', () => {
  const direct = { distanceMeters: 900, stops: [], coordinates: [[38.9, -77], [38.91, -77.01]] };
  const green = { distanceMeters: 1200, stops: [{ category: 'park', tags: ['park'] }, { category: 'trail', tags: ['trail'] }], coordinates: [[38.9, -77], [38.905, -77.02], [38.91, -77.01]] };
  assert.ok(objectiveCost(direct, 'shortest') < objectiveCost(green, 'shortest'));
  assert.equal(objectiveCost(green, 'green'), green.distanceMeters);
  assert.doesNotMatch(routeExplanation(green).join(' '), /shaded|accessible|canopy coverage/i);
});

test('auto round trips normalize place locations and order stops before routing', () => {
  assert.match(plannerSource, /normalizeStop/);
  assert.match(plannerSource, /stop\?\.location/);
  assert.match(plannerSource, /orderAutoRoundTripStops/);
  assert.match(plannerSource, /fallbackAutoRoundTripStop/);
  assert.match(plannerSource, /\[center, \.\.\.stops, center\]/);
  assert.match(plannerSource, /routeOnFoot\(points/);
});

test('auto round trip keeps candidates whose coordinates are nested in location', () => {
  const previousCity = state.activeCity;
  const previousPois = state.cityPois;
  state.activeCity = 'test-city';
  state.cityPois = { 'test-city': [{ id: 'nested-place', name: 'Nested Place', location: { lat: 38.901, lng: -77.001 } }] };
  try {
    assert.equal(candidateStops({ lat: 38.9, lng: -77 }, []).length, 1);
    assert.equal(candidateStops({ lat: 38.9, lng: -77 }, [])[0].lat, 38.901);
  } finally {
    state.activeCity = previousCity;
    state.cityPois = previousPois;
  }
});
