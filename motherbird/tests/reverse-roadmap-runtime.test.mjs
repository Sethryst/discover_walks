import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCountyAddition } from '../js/county-additions.js';
import { installedRegionIdForCity } from '../js/installed-region-runtime.js';
import { sortGuideCardsByDistance } from '../js/field-guide.js';
import { JOURNAL_TRANSFER_STORES } from '../js/journal-transfer.js';

const authority = { name: 'County Parks', officialUrl: 'https://example.gov/parks', license: 'CC0-1.0' };

test('county additions are checksummed public sidecars with no journal media path', async () => {
  const unsigned = {
    export_format: 'walk-wildlife-county-addition-v1', version: 1, id: 'fall-update', region_id: 'fairfax-county-va', name: 'Fall park update', created: '2026-09-02T00:00:00.000Z', authority,
    additions: {
      points: [{ id: 'new-park', name: 'New Park', lat: 38.85, lng: -77.31, category: 'park', tags: ['park'], source: authority }],
      lines: [{ id: 'closed-trail', name: 'Creek Trail closure', category: 'trail', geometry: { type: 'LineString', coordinates: [[-77.31, 38.85], [-77.30, 38.86]] }, source: authority }]
    }
  };
  const signed = await normalizeCountyAddition(unsigned, { verifyChecksum: false });
  assert.match(signed.checksum, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(await normalizeCountyAddition(JSON.stringify(signed)), signed);
  await assert.rejects(() => normalizeCountyAddition({ ...signed, observations: [{ photo: 'private' }] }), /cannot contain private/i);
  assert.equal(JOURNAL_TRANSFER_STORES.includes('journal_audio'), false);
  assert.equal(JOURNAL_TRANSFER_STORES.includes('county_additions'), false);
});

test('installed runtime resolves static city ids to their region folder', () => {
  const installed = [{ id: 'fairfax-county-va' }, { id: 'washington-dc' }];
  assert.equal(installedRegionIdForCity('fairfax', installed), 'fairfax-county-va');
  assert.equal(installedRegionIdForCity('dc', installed), 'washington-dc');
});

test('Field Guide cards sort from a fix and retain pack order without one', () => {
  const cards = [{ id: 'far' }, { id: 'near' }, { id: 'missing' }];
  const coordinates = { far: [{ lat: 38.9, lng: -77.4 }], near: [{ lat: 38.8501, lng: -77.3 }], missing: [] };
  assert.deepEqual(sortGuideCardsByDistance(cards, { lat: 38.85, lng: -77.3 }, (card) => coordinates[card.id]).map((card) => card.id), ['near', 'far', 'missing']);
  assert.deepEqual(sortGuideCardsByDistance(cards, null, () => []).map((card) => card.id), ['far', 'near', 'missing']);
});

