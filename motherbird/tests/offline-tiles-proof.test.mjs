import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { generateProofArchive, PROOF_LOCATION } from './fixtures/pmtiles-proof.mjs';
import { installedTileStyle, offlinePresetSvg, OFFLINE_MAP_PRESETS } from '../js/offline-map-style.js';
import { openInstalledTileArchive, probeInstalledTile } from '../js/installed-tiles.js';
import { buildSelectedBackup } from '../js/sealed-data.js';
import { importSealKey, sealJson, openSealedJson, journalPayloadToBytea, journalPayloadFromBytea } from '../js/cloud-journal.js';
import { validateViewConditions, applyOfflineBootConditions } from '../js/offline-view.js';
import { RegionInstaller } from '../js/region-installer.js';
import { RegionAPI } from '../js/region-api.js';
import db from '../js/storage.js';
import { state } from '../js/state.js';

// Load the exact independent reader shipped to browsers, not a mock decoder.
const pmtiles = runInNewContext(`${await readFile(new URL('../vendor/pmtiles.js', import.meta.url), 'utf8')}\n; pmtiles`, { TextDecoder, TextEncoder, Response, DecompressionStream, AbortController, Headers, fetch: (...args) => globalThis.fetch(...args) });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = generateProofArchive(pmtiles.zxyToTileId);

test('Dark satellite is the first SVG preset; both styles are entirely local', () => {
  assert.equal(OFFLINE_MAP_PRESETS[0].id, 'dark-satellite');
  for (const preset of OFFLINE_MAP_PRESETS) {
    const svg = offlinePresetSvg(preset.id), style = installedTileStyle('pmtiles://proof.pmtiles', preset.id);
    assert.match(svg, /<svg/); assert.ok(svg.includes(preset.colors.paper));
    assert.equal(style.layers[0].paint['background-color'], preset.colors.paper);
    assert.equal(style.sources.field.url, 'pmtiles://proof.pmtiles');
    assert.doesNotMatch(svg, /<script|<image|href=/);
    assert.equal(style.sprite, undefined); assert.equal(style.glyphs, undefined);
  }
  assert.throws(() => installedTileStyle('pmtiles://https://example.com/map.pmtiles'), /installed/);
  assert.throws(() => offlinePresetSvg('<img>'), /Unknown/);
});

test('generated PMTiles: HTTP range read, checked installation, cold offline tile and seal round-trip', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.headers.range || 'full');
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
    if (match) {
      const start = Number(match[1]), end = Math.min(Number(match[2]), fixture.bytes.length - 1);
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fixture.bytes.length}`, 'Content-Type': 'application/vnd.pmtiles' });
      response.end(fixture.bytes.slice(start, end + 1));
    } else response.end(fixture.bytes);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/proof.pmtiles`;
  const online = new pmtiles.PMTiles(url);
  const onlineTile = await online.getZxy(fixture.z, fixture.x, fixture.y);
  assert.equal(hash(new Uint8Array(onlineTile.data)), hash(fixture.tile));
  assert.ok(requests.some((item) => item.startsWith('bytes=')));
  const stores = new Map(), files = new Map();
  const storage = { put: async (name, row) => stores.set(`${name}:${row.id}`, row), get: async (name, id) => stores.get(`${name}:${id}`), all: async (name) => [...stores].filter(([key]) => key.startsWith(`${name}:`)).map(([,row]) => row) };
  const opfs = { ensureDirectory: async () => {}, writeFile: async (path, blob) => files.set(path, new File([blob], path.split('/').at(-1))), readFile: async (path) => files.get(path), remove: async () => {} };
  const installer = new RegionInstaller({ db: storage, opfs });
  const api = new RegionAPI({ installer, packageResolver: async () => ({ id: 'fairfax-county-va', name: 'Synthetic proof only', pmtilesBlob: await (await fetch(url)).blob(), manifest: { checksums: { 'fairfax-county-va.pmtiles': `sha256:${hash(fixture.bytes)}` } } }) });
  await api.installRegion('fairfax-county-va');
  await new Promise((resolve) => server.close(resolve));
  const oldFetch = globalThis.fetch, oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldAll = db.all;
  const previousState = { settings: state.settings, offlineView: state.offlineView, activeCity: state.activeCity, layerLights: state.layerLights, layerFilters: state.layerFilters };
  let blockedRequests = 0;
  globalThis.fetch = async () => { blockedRequests += 1; throw new Error('Network forbidden'); };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  t.after(() => { globalThis.fetch = oldFetch; if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else delete globalThis.navigator; db.all = oldAll; Object.assign(state, previousState); });
  const loaded = await api.loadRegion('fairfax-county-va');
  const file = await opfs.readFile(loaded.mapSource.path);
  const { archive } = await openInstalledTileArchive(file, pmtiles); // fresh cache
  const offlineTile = await archive.getZxy(fixture.z, fixture.x, fixture.y);
  assert.equal(hash(new Uint8Array(offlineTile.data)), hash(new Uint8Array(onlineTile.data)));
  assert.equal((await probeInstalledTile(file, PROOF_LOCATION, pmtiles)).bytes, fixture.tile.length);
  const view = validateViewConditions({ pack_id: 'fairfax-county-va', preset: 'dark-satellite', zoom: 14, range: { type: 'radius', center: { lat: 38.9, lng: -77.3 }, meters: 50 }, layers: { lights: { news: true, recreation: true, cuisine: true }, public: {}, personal: {} } });
  const backup = await buildSelectedBackup({ moments: [{ id: 'private-note', note: 'DO NOT UPLOAD PLAINTEXT' }], regions: [{ tiles: fixture.bytes }] }, { offline: true }, view);
  const key = await importSealKey(crypto.getRandomValues(new Uint8Array(32)));
  const sealed = await sealJson(backup, key, 'personal:proof-owner');
  const packed = new TextEncoder().encode(JSON.stringify(sealed));
  assert.doesNotMatch(new TextDecoder().decode(packed), /DO NOT UPLOAD|dark-satellite|38\.9|PMTiles/);
  const restored = await openSealedJson(JSON.parse(new TextDecoder().decode(journalPayloadFromBytea(journalPayloadToBytea(packed)))), key, 'personal:proof-owner');
  assert.deepEqual(validateViewConditions(restored.viewConditions), view);
  assert.equal('regions' in restored.data, false);
  await assert.rejects(() => openSealedJson(sealed, key, 'personal:other-owner'));
  state.settings = { viewConditions: restored.viewConditions }; db.all = storage.all;
  await applyOfflineBootConditions();
  assert.equal(state.activeCity, 'fairfax'); assert.deepEqual(state.offlineView, view);
  assert.equal(hash(generateProofArchive(pmtiles.zxyToTileId).bytes), hash(fixture.bytes));
  assert.equal(blockedRequests, 0);
  t.diagnostic(`Synthetic archive SHA-256 ${hash(fixture.bytes)}; tile ${fixture.z}/${fixture.x}/${fixture.y}, ${fixture.tile.length} bytes; HTTP and cold offline bytes identical; zero offline fetch calls. Storage adapter simulated; no Supabase write.`);
});

test('placeholder, corrupt metadata, raster, and uncovered location never pass installed proof', async () => {
  await assert.rejects(() => openInstalledTileArchive(new File(['{"type":"pmtiles"}'], 'placeholder.pmtiles'), pmtiles), /placeholder/);
  const fake = new Uint8Array(128); fake.set(new TextEncoder().encode('PMTiles'));
  await assert.rejects(() => openInstalledTileArchive(new File([fake], 'fake.pmtiles'), pmtiles), /v3/);
  const raster = fixture.bytes.slice(); raster[99] = 2;
  await assert.rejects(() => openInstalledTileArchive(new File([raster], 'raster.pmtiles'), pmtiles), /MVT/);
  await assert.rejects(() => openInstalledTileArchive(new File([fixture.bytes.slice(0, -1)], 'truncated.pmtiles'), pmtiles), /truncated/);
  const badMetadata = fixture.bytes.slice();
  badMetadata[Number(new DataView(badMetadata.buffer).getBigUint64(24, true))] = 0;
  await assert.rejects(() => openInstalledTileArchive(new File([badMetadata], 'bad-metadata.pmtiles'), pmtiles));
  await assert.rejects(() => probeInstalledTile(new File([fixture.bytes], 'proof.pmtiles'), { lat: 0, lng: 0, zoom: 14 }, pmtiles), /not proven/);
});

test('unknown presets fail validation; absent presets keep legacy seals compatible', () => {
  const view = { pack_id: 'fairfax-county-va', zoom: 14, range: { type: 'radius', center: { lat: 38.9, lng: -77.3 }, meters: 50 }, layers: {} };
  assert.deepEqual(validateViewConditions(view), view);
  assert.throws(() => validateViewConditions({ ...view, preset: 'https://remote/style.json' }), /Unknown/);
});

test('offline shell includes the style and reader; preview never copies a remote map style', async () => {
  const shell = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  for (const file of ['offline-map-style.js', 'installed-tiles.js']) assert.ok(shell.includes(`./js/${file}`));
  const preview = await readFile(new URL('../js/offline-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(preview, /getStyle\(/);
  for (const file of await readdir(new URL('../js/', import.meta.url))) {
    if (/\.(js|mjs)$/.test(file)) assert.ok(shell.includes(`./js/${file}`), `Pre-cache runtime module ${file}`);
  }
  assert.ok(shell.includes('./data/dc-official-trails.js'), 'Static data-module imports are also boot dependencies');
  assert.match(shell, /shellPaths\.has\(url\.pathname\)/);
});
