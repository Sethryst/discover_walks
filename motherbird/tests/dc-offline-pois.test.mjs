import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RegionInstaller } from '../js/region-installer.js';

test('DC region POIs survive install and offline load', async () => {
  const records = new Map();
  const db = { async put(store, value) { records.set(`${store}:${value.id}`, structuredClone(value)); }, async get(store, id) { return records.get(`${store}:${id}`); }, async all(store) { return [...records.entries()].filter(([key]) => key.startsWith(`${store}:`)).map(([, value]) => value); } };
  const files = new Map();
  const opfs = { async ensureDirectory() {}, async writeFile(name, blob) { files.set(name, blob); }, async remove() {} };
  const poiData = JSON.parse(await readFile(new URL('../regions/washington-dc/washington-dc-poi.json', import.meta.url), 'utf8'));
  const installer = new RegionInstaller({ db, opfs });
  await installer.install({ id: 'washington-dc', name: 'Washington, DC', manifest: { version: 1 }, pmtilesBlob: new Blob(['PMTiles', new Uint8Array(121)]), poiData, bucketsData: {} });
  const loaded = await installer.load('washington-dc');
  assert.equal(loaded.ready, true); assert.equal(loaded.pois.length, poiData.pois.length); assert.ok(loaded.pois.length >= 500); assert.ok(files.has('regions/washington-dc/washington-dc.pmtiles'));
});
