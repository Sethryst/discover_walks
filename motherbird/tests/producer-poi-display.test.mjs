import assert from 'node:assert/strict';
import { activeSeasonalSignals, displayPoiName, isVisiblePoi } from '../js/poi.js';

const now = Date.parse('2026-08-06T12:00:00Z');
const activeWildlife = { category: 'wildlife', seasonalSignals: [{ expiresAt: '2026-08-07T12:00:00Z' }] };
const expiredWildlife = { category: 'wildlife', seasonalSignals: [{ expiresAt: '2026-08-05T12:00:00Z' }] };

assert.equal(activeSeasonalSignals(activeWildlife, now).length, 1);
assert.equal(isVisiblePoi(activeWildlife, now), true);
assert.equal(isVisiblePoi(expiredWildlife, now), false);
assert.equal(isVisiblePoi({ category: 'coffee', review: { validationStatus: 'invalid' } }, now), false);
assert.equal(isVisiblePoi({ category: 'event', freshnessExpiresAt: '2026-08-07T12:00:00Z', isFree: true }, now), true);
assert.equal(isVisiblePoi({ category: 'event', freshnessExpiresAt: '2026-08-05T12:00:00Z', isFree: true }, now), false);
assert.equal(isVisiblePoi({ category: 'event', endsAt: '2026-08-07T12:00:00Z', isFree: true }, now), false);
assert.equal(displayPoiName({ category: 'water', name: '03N 02E 10BBCC1', monitoringLocationId: 'x', type: 'Well' }), 'USGS water monitoring location · Well');
assert.equal(isVisiblePoi({ category: 'water', monitoringLocationId: 'x', name: '03N 02E 10BBCC1' }, now), false);
console.log('✓ producer POI display rules pass');
