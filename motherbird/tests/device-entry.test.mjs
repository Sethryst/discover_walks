import assert from 'node:assert/strict';
import test from 'node:test';
import { isLikelyWatchDevice, shouldUseWatchEntrance } from '../js/device-entry.js';

test('watch entrance detects explicit watch agents and compact square screens', () => {
  assert.equal(isLikelyWatchDevice({ userAgent: 'Mozilla/5.0 (Watch OS)', width: 396, height: 484 }), true);
  assert.equal(isLikelyWatchDevice({ userAgent: 'Mozilla/5.0', width: 320, height: 320 }), true);
  assert.equal(isLikelyWatchDevice({ userAgent: 'Mozilla/5.0', width: 375, height: 667 }), false);
});

test('an explicit full view always overrides automatic watch detection', () => {
  assert.equal(shouldUseWatchEntrance({ search: '?view=phone', userAgent: 'Watch OS', width: 320, height: 320 }), false);
  assert.equal(shouldUseWatchEntrance({ search: '?view=watch', userAgent: 'Desktop', width: 1440, height: 900 }), true);
});
