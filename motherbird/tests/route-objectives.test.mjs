import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveCost, routeExplanation } from '../js/planner.js';

test('the single-sketch planner reports distance without inventing green or shade scores', () => {
  const direct = { distanceMeters: 900, stops: [], coordinates: [[38.9, -77], [38.91, -77.01]] };
  const green = { distanceMeters: 1200, stops: [{ category: 'park', tags: ['park'] }, { category: 'trail', tags: ['trail'] }], coordinates: [[38.9, -77], [38.905, -77.02], [38.91, -77.01]] };
  assert.ok(objectiveCost(direct, 'shortest') < objectiveCost(green, 'shortest'));
  assert.equal(objectiveCost(green, 'green'), green.distanceMeters);
  assert.doesNotMatch(routeExplanation(green).join(' '), /shaded|accessible|canopy coverage/i);
});
