import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNationalPoiArchive, publishedNationalPoi, publishedStateProduct, fetchOsmReleaseManifest } from '../js/osm-release.js';
import { RegionInstaller } from '../js/region-installer.js';

test('roadway and POI cloud availability remain independent', () => {
  const manifest = { states: { 'us-va': {
    id: 'us-va', code: 'VA', roadway: { cloudAvailable: true, url: 'https://example/road.pmtiles', sha256: 'a' },
    poi: { cloudAvailable: false, url: null, sha256: 'b' }
  } } };
  assert.equal(publishedStateProduct(manifest, 'us-va', 'roadway').url, 'https://example/road.pmtiles');
  assert.equal(publishedStateProduct(manifest, 'us-va', 'poi'), null);
});

test('national POIs expose only a range-backed archive and reject installable manifests', () => {
  const manifest = { national: { poi: {
    cloudAvailable: true,
    url: 'https://example.test/national/poi.pmtiles',
    bytes: 123,
    delivery: {
      mode: 'http_range', fullDownloadAllowed: false, offlineInstallable: false, requiresAcceptRangesBytes: true
    }
  } } };
  const calls = [];
  class FetchSource {
    constructor(url) { this.url = url; calls.push(['range-source', url]); }
  }
  class PMTiles {
    constructor(source) { this.source = source; calls.push(['archive', source.url]); }
  }
  const rangeBacked = createNationalPoiArchive(manifest, { pmtilesImpl: { FetchSource, PMTiles } });
  assert.equal(rangeBacked.url, manifest.national.poi.url);
  assert.deepEqual(calls, [
    ['range-source', manifest.national.poi.url],
    ['archive', manifest.national.poi.url]
  ]);

  manifest.national.poi.delivery.offlineInstallable = true;
  assert.throws(() => publishedNationalPoi(manifest), /range-only delivery/);
});

test('browser consumes an explicitly configured public release manifest', async () => {
  const expected = { release: 'osm-us-2026-09-07', states: {} };
  const actual = await fetchOsmReleaseManifest({
    url: 'https://example.test/manifest.json',
    fetchImpl: async (url) => ({ ok: url.startsWith('https://'), json: async () => expected })
  });
  assert.deepEqual(actual, expected);
});

test('browser assets contain no service-role credential', async () => {
  const config = await readFile(new URL('../supabase-config.js', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../js/osm-release.js', import.meta.url), 'utf8');
  assert.doesNotMatch(config + runtime, /serviceRoleKey\s*:|service_role_key\s*:|sb_secret_/i);
  assert.match(config, /anonKey/);
});

test('roadway and POI install status remains independent in existing IndexedDB/OPFS stores', async () => {
  const rows = new Map(), files = new Map();
  const db = {
    get: async (store, id) => rows.get(`${store}:${id}`) || null,
    put: async (store, value) => rows.set(`${store}:${value.id}`, value)
  };
  const opfs = {
    ensureDirectory: async () => {},
    writeFile: async (path, blob) => files.set(path, blob)
  };
  const installer = new RegionInstaller({ db, opfs });
  const bytes = new Uint8Array(128); bytes.set(new TextEncoder().encode('PMTiles')); bytes[7] = 3;
  await installer.installOsmProduct({ state: { id: 'us-va', name: 'Virginia' }, product: 'roadway', blob: new Blob([bytes]), manifest: { bytes: 128, featureCount: 1 } });
  const status = await installer.osmProductStatus('us-va');
  assert.equal(status.roadway.status, 'installed');
  assert.equal(status.poi, undefined);
  assert.ok(files.has('regions/us-va/roadway.pmtiles'));
  assert.equal(files.has('regions/us-va/poi.pmtiles'), false);
});
