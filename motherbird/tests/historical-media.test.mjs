import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalMediaPresentation, loadHistoricalMediaIndex } from '../js/historical-media.js';

test('historical media loader validates compact approved index', async () => {
  const index = await loadHistoricalMediaIndex('/fixture', async () => ({ ok: true, json: async () => ({ schema_version: 1, records: [] }) }));
  assert.equal(index.records.length, 0);
});

test('city-level evidence is presented as approximate', () => {
  assert.equal(historicalMediaPresentation({ location: { precision: 'city' } }).isApproximate, true);
});
