import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelayMs } from '../js/outbox-runtime.js';

test('outbox retry delay is exponential and capped', () => {
  assert.equal(retryDelayMs(0), 1000);
  assert.equal(retryDelayMs(3), 8000);
  assert.equal(retryDelayMs(99), 15 * 60 * 1000);
});
