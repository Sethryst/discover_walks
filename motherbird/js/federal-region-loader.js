import { FlatbushPackageIndex } from './spatial-index-providers.js';

/** Viewport loader for immutable nationwide federal boundary shards. */
export class FederalRegionLoader {
  constructor(baseUrl, { fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Federal region loading requires fetch.');
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.cryptoImpl = cryptoImpl;
    this.cache = new Map();
  }

  async manifest() {
    return this.memo('manifest', async () => {
      const manifest = await this.fetchJson(`${this.baseUrl}/manifest.json`, 'federal region manifest');
      validateManifest(manifest);
      return manifest;
    });
  }

  async loadViewport({ bbox, zoom, congress } = {}) {
    validateRequest(bbox, zoom);
    const manifest = await this.manifest();
    const selectedCongress = congress ?? manifest.congressPolicy.current;
    if (!manifest.congressPolicy.hot.includes(selectedCongress)) throw new Error(`Congress ${selectedCongress} is not in the hot retention window.`);
    const version = manifest.shards.congress[String(selectedCongress)];
    const selectedShards = [];

    if (zoom <= 4) {
      selectedShards.push(manifest.shards.base.national, version.national);
    } else {
      const stateCandidates = await this.queryIndex(manifest.shards.base.national, bbox);
      const stateFips = [...new Set(stateCandidates.filter((record) => record.boundaryType === 'state').map((record) => record.stateFips))].sort();
      for (const fips of stateFips) {
        if (manifest.shards.base.states[fips]) selectedShards.push(manifest.shards.base.states[fips]);
        if (version.states[fips]) selectedShards.push(version.states[fips]);
      }
    }

    const loaded = await Promise.all(selectedShards.map((shard) => this.loadShard(shard, bbox)));
    const features = loaded.flatMap((result) => result.features);
    return {
      type: 'FeatureCollection',
      features,
      metadata: {
        congress: selectedCongress,
        zoom,
        stateFips: [...new Set(features.map((feature) => feature.properties.stateFips))].sort(),
        loadedShards: selectedShards.map((shard) => shard.display),
        municipalDeferred: zoom >= 8
      }
    };
  }

  async loadShard(shard, bbox) {
    const [index, display] = await Promise.all([
      this.loadIndex(shard),
      this.memo(`display:${shard.display}`, async () => {
        const payload = await this.fetchBytes(this.url(shard.display), 'federal display shard');
        await verifyChecksum(payload, shard.displayChecksum, this.cryptoImpl, 'federal display shard');
        const document = parseJson(payload, 'federal display shard');
        return new Map(document.features.map((feature) => [String(feature.id || feature.properties?.boundary_id), feature]));
      })
    ]);
    return { features: index.searchBbox(...bbox).map((record) => display.get(record.id)).filter(Boolean) };
  }

  async queryIndex(shard, bbox) { return (await this.loadIndex(shard)).searchBbox(...bbox); }

  async loadIndex(shard) {
    return this.memo(`index:${shard.index}`, async () => {
      const [binary, idsPayload] = await Promise.all([
        this.fetchBytes(this.url(shard.index), 'federal Flatbush index'),
        this.fetchBytes(this.url(shard.ids), 'federal index sidecar')
      ]);
      await Promise.all([
        verifyChecksum(binary, shard.indexChecksum, this.cryptoImpl, 'federal Flatbush index'),
        verifyChecksum(idsPayload, shard.idsChecksum, this.cryptoImpl, 'federal index sidecar')
      ]);
      const sidecar = parseJson(idsPayload, 'federal index sidecar');
      if (sidecar.schemaVersion !== 1 || !Array.isArray(sidecar.records)) throw new Error('Federal index sidecar schema is incompatible.');
      return new FlatbushPackageIndex({
        data: exactArrayBuffer(binary),
        ids: sidecar.records.map((record) => String(record.id)),
        records: sidecar.records,
        expectedCount: shard.featureCount
      });
    });
  }

  memo(key, producer) {
    if (!this.cache.has(key)) this.cache.set(key, Promise.resolve().then(producer).catch((error) => { this.cache.delete(key); throw error; }));
    return this.cache.get(key);
  }

  url(relative) { return `${this.baseUrl}/${relative}`; }
  async fetchJson(url, label) { return parseJson(await this.fetchBytes(url, label), label); }
  async fetchBytes(url, label) {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.artifactType !== 'nationwide-federal-region-shards') throw new Error('Federal region manifest schema is incompatible.');
  if (manifest.coordinateOrder !== 'minLng,minLat,maxLng,maxLat' || manifest.geometryPolicy?.indexRole !== 'candidate-prefilter-only') throw new Error('Federal region spatial semantics are incompatible.');
  if (!Array.isArray(manifest.congressPolicy?.hot) || manifest.congressPolicy.hot.length < 1 || manifest.congressPolicy.hot.length > 2) throw new Error('Federal region Congress retention contract is invalid.');
}

function validateRequest(bbox, zoom) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value)) || bbox[0] > bbox[2] || bbox[1] > bbox[3]) throw new TypeError('Federal region viewport requires [west,south,east,north].');
  if (!Number.isFinite(zoom) || zoom < 0) throw new TypeError('Federal region viewport requires a non-negative zoom.');
}

function parseJson(bytes, label) {
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error(`${label} is not valid JSON.`); }
}

async function verifyChecksum(bytes, expected, cryptoImpl, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(expected || '')) throw new Error(`${label} checksum declaration is invalid.`);
  if (!cryptoImpl?.subtle) throw new Error('Federal region verification requires Web Crypto.');
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  const actual = `sha256:${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  if (actual !== expected) throw new Error(`${label} checksum mismatch.`);
}

function exactArrayBuffer(bytes) {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export const federalRegionLoaderTestHelpers = { validateManifest, validateRequest, verifyChecksum };
