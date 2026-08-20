import assert from 'node:assert/strict';
import { RegionPackage } from '../js/region-package.js';
import { RegionInstaller } from '../js/region-installer.js';
import { RegionAPI } from '../js/region-api.js';

class FakeDb {
  constructor() {
    this.data = new Map();
    this.stores = new Map();
  }

  async put(storeName, item) {
    if (!this.stores.has(storeName)) this.stores.set(storeName, []);
    const existing = this.stores.get(storeName).findIndex((entry) => entry.id === item.id);
    if (existing >= 0) this.stores.get(storeName)[existing] = item;
    else this.stores.get(storeName).push(item);
    this.data.set(`${storeName}:${item.id}`, item);
    return item;
  }

  async get(storeName, id) {
    return this.data.get(`${storeName}:${id}`) || null;
  }

  async all(storeName) {
    return this.stores.get(storeName) || [];
  }
}

class FakeOpfs {
  constructor() {
    this.files = new Map();
  }

  async ensureDirectory(pathParts) {
    return pathParts.join('/');
  }

  async writeFile(path, blob) {
    this.files.set(path, blob);
    return path;
  }

  async readFile(path) {
    return this.files.get(path) || null;
  }

  async remove(path) {
    this.files.delete(path);
  }
}

const fakeDb = new FakeDb();
const fakeOpfs = new FakeOpfs();
const installer = new RegionInstaller({ db: fakeDb, opfs: fakeOpfs });

const packageData = new RegionPackage({
  id: 'vienna',
  manifest: {
    regionId: 'vienna',
    name: 'Vienna',
    artifacts: {
      pmtiles: 'regions/vienna/vienna.pmtiles',
      poi: 'regions/vienna/vienna-poi.json',
      buckets: 'regions/vienna/vienna-buckets.json'
    }
  },
  pmtilesBlob: new Blob(['pmtiles-data'], { type: 'application/x-pmtiles' }),
  poiData: { pois: [{ id: 'poi-1', name: 'Museum' }] },
  bucketsData: { universalBuckets: [{ name: 'history' }] }
});

const api = new RegionAPI({ installer, packageResolver: async () => packageData });
const installed = await api.installRegion('vienna');
assert.equal(installed.id, 'vienna');
assert.equal(installed.mapSource.type, 'opfs');
assert.equal(installed.pois.length, 1);
assert.equal(installed.buckets.universalBuckets.length, 1);

const discovered = await api.discoverRegions();
assert.ok(discovered.some((entry) => entry.id === 'vienna'));

const loaded = await api.loadRegion('vienna');
assert.equal(loaded.id, 'vienna');
console.log('region runtime test passed');
