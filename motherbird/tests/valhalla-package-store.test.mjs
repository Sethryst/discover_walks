import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportValhallaPackage,
  importValhallaPackage,
  installValhallaPackage,
  listInstalledValhallaPackages,
  removeValhallaPackage,
  resolveInstalledValhallaManifest
} from '../js/valhalla-package-store.js';

test('installs a verified Valhalla release under device-local URLs', async () => {
  const release = 'dc-v1';
  const manifestUrl = `https://static.example/datasets/${release}/manifest.json`;
  const config = new TextEncoder().encode('{"mjolnir":{}}');
  const tile = new Uint8Array([1, 3, 5, 7]);
  const manifest = {
    schema: 1,
    release,
    valhallaRevision: 'a60c7cbfc83e073f50887cd27e0109d02e6b64e5',
    valhallaVersion: '3.8.3',
    costings: ['auto', 'bicycle', 'pedestrian', 'truck'],
    config: { url: 'config.json', sha256: await sha256(config) },
    tiles: {
      42: { path: '2/000/001/002.gph', size: tile.byteLength, sha256: await sha256(tile) }
    }
  };
  const sources = new Map([
    [manifestUrl, new TextEncoder().encode(JSON.stringify(manifest))],
    [`https://static.example/datasets/${release}/config.json`, config],
    [`https://static.example/datasets/${release}/tiles/2/000/001/002.gph`, tile]
  ]);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([String(url), options]);
    const bytes = sources.get(String(url));
    return bytes ? new Response(bytes) : new Response('', { status: 404 });
  };
  const cachesImpl = memoryCaches();

  const installed = await installValhallaPackage(manifestUrl, {
    fetchImpl, cachesImpl, baseUrl: 'https://app.example/'
  });

  assert.equal(installed.release, release);
  assert.equal(installed.transport, 'individual-tiles');
  assert.match(installed.localManifestUrl, /\/__valhalla_offline__\/.+\/dc-v1\/manifest\.json$/);
  assert.equal(requests.every(([, options]) => options.credentials === 'omit' && options.referrerPolicy === 'no-referrer'), true);
  assert.equal(requests.some(([url]) => /lat|lng|origin|destination/.test(url)), false);
  assert.deepEqual(await resolveInstalledValhallaManifest(manifestUrl, { cachesImpl, baseUrl: 'https://app.example/' }), installed);
  assert.equal((await listInstalledValhallaPackages({ cachesImpl })).length, 1);

  const exported = await exportValhallaPackage(manifestUrl, { cachesImpl, baseUrl: 'https://app.example/' });
  const portable = JSON.parse(await exported.text());
  assert.equal(portable.format, 'walk-wildlife-valhalla-package-v1');
  assert.deepEqual(portable.components.map((component) => component.path).sort(), [
    'config.json', 'manifest.json', 'tiles/2/000/001/002.gph'
  ]);
  assert.equal(await removeValhallaPackage(manifestUrl, { cachesImpl, baseUrl: 'https://app.example/' }), true);
  assert.equal(await resolveInstalledValhallaManifest(manifestUrl, { cachesImpl, baseUrl: 'https://app.example/' }), null);

  const imported = await importValhallaPackage(exported, { cachesImpl, baseUrl: 'https://app.example/' });
  assert.equal(imported.imported, true);
  assert.equal(imported.release, release);
  assert.equal((await listInstalledValhallaPackages({ cachesImpl })).length, 1);
});

function memoryCaches() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(key) { return store.get(urlOf(key))?.clone() || undefined; },
        async put(key, response) { store.set(urlOf(key), response.clone()); },
        async delete(key) { return store.delete(urlOf(key)); },
        async keys() { return [...store.keys()].map((url) => new Request(url)); }
      };
    }
  };
}

function urlOf(value) { return typeof value === 'string' ? value : value.href || value.url; }

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
