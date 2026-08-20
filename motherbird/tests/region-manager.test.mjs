import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { RegionManager, createInMemoryStorageProvider } from '../js/region-manager.js';

const storage = createInMemoryStorageProvider();
const manager = new RegionManager(storage);

const regionConfig = {
  name: 'Vienna',
  regionKey: 'vienna',
  description: 'Town of Vienna',
  type: 'city',
  boundary: { north: 38.92, south: 38.88, east: -77.24, west: -77.29 },
  osmExtraction: { tool: 'osmium', pbfSource: 'planet', extraTags: ['name'] },
  poiSources: [],
  attribution: 'Town of Vienna',
  featuredBuckets: []
};

const region = await manager.getRegion('vienna', regionConfig);
assert.equal(region.id, 'vienna');
assert.equal(region.name, 'Vienna');
assert.equal(region.ready, true);
assert.equal(region.mapSource.type, 'local');
assert.ok(region.pois.length >= 0);
assert.ok(region.buckets.universalBuckets.length >= 0);

const discovered = await manager.discoverInstalledRegions();
assert.ok(Array.isArray(discovered));
assert.ok(discovered.some((item) => item.id === 'vienna' && item.installed));

const loaded = await manager.loadRegion('vienna');
assert.equal(loaded.id, 'vienna');
assert.ok(loaded.metadata);
const installPath = path.join(process.cwd(), 'regions', 'vienna', 'metadata.json');
await stat(installPath);
console.log('region manager test passed');
