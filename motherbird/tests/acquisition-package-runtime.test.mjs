import assert from 'node:assert/strict';
import test from 'node:test';
import { acquisitionPlacesForRegion, loadActiveAcquisitionPackage } from '../js/acquisition-package-runtime.js';

test('loads only the active schema-valid package', async () => {
  const responses = new Map([
    ['./data/acquisition-packages/active.json', { ok: true, json: async () => ({ activePackageId: 'pkg-1' }) }],
    ['./data/acquisition-packages/pkg-1.json', { ok: true, json: async () => ({ schema: 'motherbird-regional-package.v1', packageId: 'pkg-1', geography: 'region-1', places: [{ id: 'p1' }] }) }]
  ]);
  const payload = await loadActiveAcquisitionPackage({ fetchImpl: async (url) => responses.get(url) || { ok: false } });
  assert.equal(payload.packageId, 'pkg-1');
  assert.deepEqual(acquisitionPlacesForRegion(payload, ['region-1']), [{ id: 'p1', acquisitionPackageId: 'pkg-1' }]);
  assert.deepEqual(acquisitionPlacesForRegion(payload, ['other-region']), []);
});

test('rejects an invalid active package reference', async () => {
  const payload = await loadActiveAcquisitionPackage({ fetchImpl: async () => ({ ok: true, json: async () => ({ activePackageId: '../secret' }) }) });
  assert.equal(payload, null);
});
