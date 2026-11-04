export const VALHALLA_PACKAGE_CACHE = 'walk-wildlife-valhalla-packages-v1';
export const VALHALLA_REVISION = 'a60c7cbfc83e073f50887cd27e0109d02e6b64e5';
export const VALHALLA_PACKAGE_EXPORT_FORMAT = 'walk-wildlife-valhalla-package-v1';
const VIRTUAL_ROOT = '__valhalla_offline__';

/**
 * Download a complete immutable Valhalla release for offline routing.
 * Coordinates are not accepted by this API and can never enter a request.
 */
export async function installValhallaPackage(manifestUrl, {
  fetchImpl = globalThis.fetch?.bind(globalThis),
  cachesImpl = globalThis.caches,
  baseUrl = globalThis.location?.href || 'http://localhost/'
} = {}) {
  if (typeof fetchImpl !== 'function' || !cachesImpl?.open) throw new Error('Offline package storage is unavailable.');
  const sourceManifestUrl = safeManifestUrl(manifestUrl, baseUrl);
  const cache = await cachesImpl.open(VALHALLA_PACKAGE_CACHE);
  const mappingUrl = await mappingKey(sourceManifestUrl, baseUrl);
  const installed = await cache.match(mappingUrl);
  if (installed) return installed.json();

  const manifestBytes = await fetchBytes(fetchImpl, sourceManifestUrl);
  const manifest = parseManifest(manifestBytes, sourceManifestUrl);
  const packageId = await stableId(sourceManifestUrl);
  const virtualBase = new URL(`./${VIRTUAL_ROOT}/${packageId}/${encodeURIComponent(manifest.release)}/`, baseUrl);
  const staged = [];
  let installedBytes = manifestBytes.byteLength;

  try {
    const configUrl = new URL(manifest.config.url, sourceManifestUrl).href;
    const configBytes = await fetchBytes(fetchImpl, configUrl);
    installedBytes += configBytes.byteLength;
    await verifyBytes(configBytes, { sha256: manifest.config.sha256 }, 'Valhalla config');
    await putBytes(cache, new URL(manifest.config.url, virtualBase), configBytes, 'application/json');
    staged.push(new URL(manifest.config.url, virtualBase).href);

    const tileEntries = Object.values(manifest.tiles);
    await parallelLimit(tileEntries, 3, async (tile) => {
      const sourceUrl = new URL(`tiles/${tile.path}`, sourceManifestUrl).href;
      const bytes = await fetchBytes(fetchImpl, sourceUrl);
      installedBytes += bytes.byteLength;
      await verifyBytes(bytes, tile, `Valhalla tile ${tile.path}`);
      const localUrl = new URL(`tiles/${tile.path}`, virtualBase);
      await putBytes(cache, localUrl, bytes, 'application/octet-stream', tile.etag ? { ETag: tile.etag } : {});
      staged.push(localUrl.href);
    });

    const localManifestUrl = new URL('manifest.json', virtualBase);
    await putBytes(cache, localManifestUrl, manifestBytes, 'application/json');
    staged.push(localManifestUrl.href);
    const record = Object.freeze({
      sourceManifestUrl,
      localManifestUrl: localManifestUrl.href,
      release: manifest.release,
      valhallaRevision: manifest.valhallaRevision,
      transport: 'individual-tiles',
      tileCount: tileEntries.length,
      bytes: installedBytes,
      installedAt: new Date().toISOString()
    });
    await cache.put(mappingUrl, jsonResponse(record));
    return record;
  } catch (error) {
    await Promise.allSettled(staged.map((url) => cache.delete(url)));
    throw error;
  }
}

export async function resolveInstalledValhallaManifest(manifestUrl, {
  cachesImpl = globalThis.caches,
  baseUrl = globalThis.location?.href || 'http://localhost/'
} = {}) {
  const sourceManifestUrl = new URL(manifestUrl, baseUrl).href;
  if (!cachesImpl?.open) return null;
  const cache = await cachesImpl.open(VALHALLA_PACKAGE_CACHE);
  const response = await cache.match(await mappingKey(sourceManifestUrl, baseUrl));
  return response ? response.json() : null;
}

export async function listInstalledValhallaPackages({
  cachesImpl = globalThis.caches
} = {}) {
  if (!cachesImpl?.open) return [];
  const cache = await cachesImpl.open(VALHALLA_PACKAGE_CACHE);
  const keys = await cache.keys();
  const records = await Promise.all(keys
    .filter((request) => new URL(request.url).pathname.includes(`/${VIRTUAL_ROOT}/mappings/`))
    .map(async (request) => cache.match(request).then((response) => response?.json())));
  return records.filter(Boolean).sort((left, right) => left.release.localeCompare(right.release));
}

export async function exportValhallaPackage(manifestUrl, {
  cachesImpl = globalThis.caches,
  baseUrl = globalThis.location?.href || 'http://localhost/'
} = {}) {
  if (!cachesImpl?.open) throw new Error('Offline package storage is unavailable.');
  const installed = await resolveInstalledValhallaManifest(manifestUrl, { cachesImpl, baseUrl });
  if (!installed) throw new Error('That Valhalla package is not installed.');
  const cache = await cachesImpl.open(VALHALLA_PACKAGE_CACHE);
  const prefix = new URL('.', installed.localManifestUrl).href;
  const keys = (await cache.keys()).filter((request) => request.url.startsWith(prefix));
  const components = [];
  for (const request of keys.sort((left, right) => left.url.localeCompare(right.url))) {
    const response = await cache.match(request);
    if (!response) throw new Error('Installed Valhalla package is incomplete.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    components.push({
      path: decodeURIComponent(request.url.slice(prefix.length)),
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      etag: response.headers.get('etag') || null,
      body: bytesToBase64(bytes)
    });
  }
  const payload = {
    format: VALHALLA_PACKAGE_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    sourceManifestUrl: installed.sourceManifestUrl,
    release: installed.release,
    valhallaRevision: installed.valhallaRevision,
    transport: 'individual-tiles',
    components
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/vnd.walk-wildlife.valhalla+json' });
}

export async function importValhallaPackage(input, {
  cachesImpl = globalThis.caches,
  baseUrl = globalThis.location?.href || 'http://localhost/'
} = {}) {
  if (!cachesImpl?.open) throw new Error('Offline package storage is unavailable.');
  const payload = typeof input?.text === 'function' ? JSON.parse(await input.text()) : input;
  if (payload?.format !== VALHALLA_PACKAGE_EXPORT_FORMAT || !Array.isArray(payload.components)) {
    throw new Error('This is not a supported Walk & Wildlife Valhalla package.');
  }
  const sourceManifestUrl = safeManifestUrl(payload.sourceManifestUrl, baseUrl);
  const byPath = new Map(payload.components.map((component) => [safeComponentPath(component.path), component]));
  if (byPath.size !== payload.components.length) throw new Error('Valhalla package contains duplicate component paths.');
  const manifestComponent = byPath.get('manifest.json');
  if (!manifestComponent) throw new Error('Valhalla package manifest is missing.');
  const manifestBytes = base64ToBytes(manifestComponent.body);
  await verifyPortableComponent(manifestBytes, manifestComponent, 'Valhalla manifest');
  const manifest = parseManifest(manifestBytes, sourceManifestUrl);
  if (manifest.release !== payload.release || manifest.valhallaRevision !== payload.valhallaRevision) {
    throw new Error('Valhalla package identity does not match its manifest.');
  }

  const expected = new Map([
    ['manifest.json', { bytes: manifestBytes, contentType: 'application/json', artifact: manifestComponent }]
  ]);
  const configComponent = byPath.get(manifest.config.url);
  if (!configComponent) throw new Error('Valhalla package config is missing.');
  const configBytes = base64ToBytes(configComponent.body);
  await verifyPortableComponent(configBytes, configComponent, 'Valhalla config');
  await verifyBytes(configBytes, manifest.config, 'Valhalla config');
  expected.set(manifest.config.url, { bytes: configBytes, contentType: 'application/json', artifact: configComponent });
  for (const tile of Object.values(manifest.tiles)) {
    const path = `tiles/${tile.path}`;
    const component = byPath.get(path);
    if (!component) throw new Error(`Valhalla package tile is missing: ${tile.path}.`);
    const bytes = base64ToBytes(component.body);
    await verifyPortableComponent(bytes, component, `Valhalla tile ${tile.path}`);
    await verifyBytes(bytes, tile, `Valhalla tile ${tile.path}`);
    expected.set(path, { bytes, contentType: 'application/octet-stream', artifact: { ...component, etag: tile.etag || component.etag } });
  }
  if (expected.size !== byPath.size) throw new Error('Valhalla package contains undeclared components.');

  const cache = await cachesImpl.open(VALHALLA_PACKAGE_CACHE);
  const packageId = await stableId(sourceManifestUrl);
  const virtualBase = new URL(`./${VIRTUAL_ROOT}/${packageId}/${encodeURIComponent(manifest.release)}/`, baseUrl);
  const staged = [];
  try {
    for (const [path, component] of expected) {
      const url = new URL(path, virtualBase);
      await putBytes(cache, url, component.bytes, component.contentType, component.artifact.etag ? { ETag: component.artifact.etag } : {});
      staged.push(url.href);
    }
    const record = Object.freeze({
      sourceManifestUrl,
      localManifestUrl: new URL('manifest.json', virtualBase).href,
      release: manifest.release,
      valhallaRevision: manifest.valhallaRevision,
      transport: 'individual-tiles',
      tileCount: Object.keys(manifest.tiles).length,
      bytes: [...expected.values()].reduce((sum, component) => sum + component.bytes.byteLength, 0),
      installedAt: new Date().toISOString(),
      imported: true
    });
    await cache.put(await mappingKey(sourceManifestUrl, baseUrl), jsonResponse(record));
    return record;
  } catch (error) {
    await Promise.allSettled(staged.map((url) => cache.delete(url)));
    throw error;
  }
}

export async function removeValhallaPackage(manifestUrl, {
  cachesImpl = globalThis.caches,
  baseUrl = globalThis.location?.href || 'http://localhost/'
} = {}) {
  if (!cachesImpl?.open) return false;
  const sourceManifestUrl = new URL(manifestUrl, baseUrl).href;
  const cache = await cachesImpl.open(VALHALLA_PACKAGE_CACHE);
  const key = await mappingKey(sourceManifestUrl, baseUrl);
  const response = await cache.match(key);
  if (!response) return false;
  const record = await response.json();
  const prefix = new URL('.', record.localManifestUrl).href;
  const keys = await cache.keys();
  await Promise.all(keys.filter((request) => request.url.startsWith(prefix)).map((request) => cache.delete(request)));
  await cache.delete(key);
  return true;
}

function parseManifest(bytes, manifestUrl) {
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw new Error('Valhalla manifest is not valid JSON.'); }
  if (manifest?.schema !== 1 || !manifest.release || manifest.valhallaRevision !== VALHALLA_REVISION) {
    throw new Error('Valhalla manifest is incompatible with the bundled runtime.');
  }
  if (!manifest.config?.url || !manifest.config?.sha256 || !manifest.tiles || typeof manifest.tiles !== 'object') {
    throw new Error('Valhalla manifest is incomplete.');
  }
  if (manifest.config.url !== 'config.json') throw new Error('Valhalla config path must be release-relative.');
  if (!Array.isArray(manifest.costings) || !['auto', 'bicycle', 'pedestrian'].every((costing) => manifest.costings.includes(costing))) {
    throw new Error('Valhalla regional package must support driving, cycling, and walking.');
  }
  const parent = decodeURIComponent(new URL('.', manifestUrl).pathname.split('/').filter(Boolean).at(-1) || '');
  if (parent !== manifest.release) throw new Error('Valhalla manifest release must match its parent directory.');
  for (const tile of Object.values(manifest.tiles)) {
    if (!/^[0-9]+(?:\/[0-9]+)+\.gph$/.test(tile?.path || '') || !tile.sha256 || !Number.isSafeInteger(Number(tile.size)) || Number(tile.size) <= 0) {
      throw new Error('Valhalla manifest contains an invalid tile record.');
    }
  }
  return manifest;
}

function safeManifestUrl(value, baseUrl) {
  const url = new URL(value, baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Valhalla manifest URL is not a safe static HTTP URL.');
  }
  return url.href;
}

function safeComponentPath(value) {
  const path = String(value || '');
  if (path === 'manifest.json' || path === 'config.json' || /^tiles\/[0-9]+(?:\/[0-9]+)+\.gph$/.test(path)) return path;
  throw new Error('Valhalla package contains an unsafe component path.');
}

async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Valhalla package returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function verifyBytes(bytes, artifact, label) {
  if (artifact.size != null && bytes.byteLength !== Number(artifact.size)) throw new Error(`${label} byte count does not match.`);
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== String(artifact.sha256).replace(/^sha256:/i, '').toLowerCase()) throw new Error(`${label} checksum does not match.`);
}

async function verifyPortableComponent(bytes, component, label) {
  if (!Number.isSafeInteger(Number(component.bytes)) || Number(component.bytes) !== bytes.byteLength) {
    throw new Error(`${label} export byte count does not match.`);
  }
  if (await sha256Hex(bytes) !== String(component.sha256 || '').toLowerCase()) {
    throw new Error(`${label} export checksum does not match.`);
  }
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function putBytes(cache, url, bytes, contentType, extraHeaders = {}) {
  await cache.put(url.href || url, new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ...extraHeaders
    }
  }));
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function mappingKey(manifestUrl, baseUrl) {
  return new URL(`./${VIRTUAL_ROOT}/mappings/${await stableId(manifestUrl)}.json`, baseUrl).href;
}

async function stableId(value) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Valhalla package component encoding is invalid.');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function parallelLimit(values, limit, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await operation(values[index]);
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}
