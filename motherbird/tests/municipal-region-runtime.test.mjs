import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CITIES } from '../js/constants.js';
import { loadCityData } from '../js/city.js';
import db from '../js/storage.js';
import { state } from '../js/state.js';
import { MUNICIPAL_REGIONS, representativePoint } from '../tools/export-municipal-pois.mjs';

const municipalIds = Object.keys(MUNICIPAL_REGIONS);

function appFileUrl(path) {
  assert.match(path, /^\.\//, `runtime path must be app-relative: ${path}`);
  return new URL(`..${path.slice(1)}`, import.meta.url);
}

test('municipal exporter rejects invalid WGS84 geometry', () => {
  assert.equal(representativePoint({ type: 'Point', coordinates: [-77, 38] })?.lat, 38);
  assert.equal(representativePoint({ type: 'Point', coordinates: [500, 38] }), null);
  assert.equal(representativePoint({ type: 'Point', coordinates: [0, 0] }), null);
  assert.equal(representativePoint({ type: 'GeometryCollection', geometries: [] }), null);
});

test('every configured city has a valid primary runtime seed', async () => {
  for (const [cityId, config] of Object.entries(CITIES)) {
    assert.equal(typeof config.dataFile, 'string', `${cityId} needs a dataFile`);
    const seed = JSON.parse(await readFile(appFileUrl(config.dataFile), 'utf8'));
    const pois = seed.pois || seed.pointsOfInterest;
    assert.ok(Array.isArray(pois), `${cityId} primary dataFile needs a POI array`);
    for (const poi of pois) {
      assert.equal(typeof poi.id, 'string', `${cityId} POI needs an id`);
      assert.ok(Number.isFinite(poi.lat) && Math.abs(poi.lat) <= 90, `${cityId}/${poi.id} has invalid latitude`);
      assert.ok(Number.isFinite(poi.lng) && Math.abs(poi.lng) <= 180, `${cityId}/${poi.id} has invalid longitude`);
    }
  }
});

test('verified municipal cities are selector-ready with authoritative boundaries and nonempty seeds', async () => {
  for (const cityId of municipalIds) {
    const config = CITIES[cityId];
    assert.ok(config, `${cityId} must be present in CITIES`);
    assert.equal(config.boundarySource?.url, MUNICIPAL_REGIONS[cityId].boundary.url);
    assert.ok(Number.isFinite(config.center?.lat) && Number.isFinite(config.center?.lng));
    assert.ok(Number.isFinite(config.zoom));
    const seed = JSON.parse(await readFile(appFileUrl(config.dataFile), 'utf8'));
    assert.ok(seed.pois.length > 0, `${cityId} cannot ship an empty seed`);
    assert.equal(seed.metadata.regionId, cityId);
    assert.equal(seed.metadata.boundarySource.url, config.boundarySource.url);
    assert.ok(seed.metadata.sourceDatasets.length > 0);
  }
});

test('every configured city dataFile loads through city.loadCityData', async () => {
  const original = { all: db.all, get: db.get, put: db.put, remove: db.remove, fetch: globalThis.fetch };
  const stores = new Map();
  db.all = async (store) => stores.get(store) || [];
  db.get = async () => null;
  db.put = async (store, item) => {
    const items = stores.get(store) || [];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) items[index] = item; else items.push(item);
    stores.set(store, items);
    return item;
  };
  db.remove = async () => undefined;
  globalThis.fetch = async (path) => {
    try {
      const content = await readFile(appFileUrl(String(path)), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(content) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };

  try {
    for (const cityId of Object.keys(CITIES)) {
      stores.clear();
      delete state.cityPois[cityId];
      await loadCityData(cityId);
      assert.ok(Array.isArray(state.cityPois[cityId]), `${cityId} did not load through loadCityData`);
    }
  } finally {
    db.all = original.all; db.get = original.get; db.put = original.put; db.remove = original.remove;
    globalThis.fetch = original.fetch;
  }
});
