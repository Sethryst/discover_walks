import { FlatbushPackageIndex, SPATIAL_INDEX_SCHEMA_VERSION } from './spatial-index-providers.js';

export async function loadFlatbushPackage(baseUrl, records, { fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Spatial package loading requires fetch.');
  const manifest = await fetchJson(fetchImpl, `${baseUrl}/spatial-index-manifest.json`, 'spatial index manifest');
  validateManifest(manifest);
  const [binary, sidecarDocument, boundaryBinary, boundarySidecarDocument] = await Promise.all([
    fetchBytes(fetchImpl, `${baseUrl}/${manifest.indexes.pois.binary}`, 'POI Flatbush binary'),
    fetchJsonBytes(fetchImpl, `${baseUrl}/${manifest.indexes.pois.ids}`, 'POI ID sidecar'),
    fetchBytes(fetchImpl, `${baseUrl}/${manifest.indexes.boundaries.binary}`, 'boundary Flatbush binary'),
    fetchJsonBytes(fetchImpl, `${baseUrl}/${manifest.indexes.boundaries.ids}`, 'boundary ID sidecar')
  ]);
  const sidecar = sidecarDocument.json;
  const boundarySidecar = boundarySidecarDocument.json;
  if (sidecar.schemaVersion !== SPATIAL_INDEX_SCHEMA_VERSION || !Array.isArray(sidecar.ids)) throw new Error('POI ID sidecar schema is incompatible.');
  if (boundarySidecar.schemaVersion !== SPATIAL_INDEX_SCHEMA_VERSION || !Array.isArray(boundarySidecar.records)) throw new Error('Boundary ID sidecar schema is incompatible.');
  await verifyChecksum(binary, manifest.indexes.pois.binaryChecksum, cryptoImpl, 'POI Flatbush binary');
  await verifyChecksum(sidecarDocument.bytes, manifest.indexes.pois.idsChecksum, cryptoImpl, 'POI ID sidecar');
  await verifyChecksum(boundaryBinary, manifest.indexes.boundaries.binaryChecksum, cryptoImpl, 'boundary Flatbush binary');
  await verifyChecksum(boundarySidecarDocument.bytes, manifest.indexes.boundaries.idsChecksum, cryptoImpl, 'boundary ID sidecar');
  await verifyRuntimeFingerprint(records, manifest.indexes.pois.recordFingerprint, cryptoImpl);
  const recordMap = new Map(records.map((record) => [String(record.id), record]));
  const boundaryIds = boundarySidecar.records.map((record) => String(record.id));
  return {
    manifest,
    poiIndex: new FlatbushPackageIndex({ data: exactArrayBuffer(binary), ids: sidecar.ids, records: recordMap, expectedCount: manifest.indexes.pois.featureCount }),
    boundaryIndex: new FlatbushPackageIndex({ data: exactArrayBuffer(boundaryBinary), ids: boundaryIds, records: boundarySidecar.records, expectedCount: manifest.indexes.boundaries.featureCount })
  };
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== SPATIAL_INDEX_SCHEMA_VERSION) throw new Error(`Unsupported spatial index schema ${manifest?.schemaVersion}.`);
  if (manifest.artifactType !== 'regional-spatial-index-package' || manifest.coordinateOrder !== 'minLng,minLat,maxLng,maxLat') throw new Error('Spatial index manifest contract is invalid.');
  for (const kind of ['pois', 'boundaries']) for (const key of ['binary', 'ids', 'binaryChecksum', 'idsChecksum', 'featureCount']) {
    if (manifest.indexes?.[kind]?.[key] === undefined) throw new Error(`Spatial index manifest is missing indexes.${kind}.${key}.`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.indexes.pois.recordFingerprint || '')) throw new Error('Spatial index manifest has an invalid POI record fingerprint.');
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
  return response.json();
}

async function fetchBytes(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchJsonBytes(fetchImpl, url, label) {
  const bytes = await fetchBytes(fetchImpl, url, label);
  try { return { bytes, json: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { throw new Error(`${label} is not valid JSON.`); }
}

async function verifyChecksum(bytes, expected, cryptoImpl, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(expected || '')) throw new Error(`${label} checksum declaration is invalid.`);
  if (!cryptoImpl?.subtle) throw new Error('Spatial package verification requires Web Crypto.');
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  const actual = `sha256:${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  if (actual !== expected) throw new Error(`${label} checksum mismatch.`);
}

async function verifyRuntimeFingerprint(records, expected, cryptoImpl) {
  const payload = records.map(({ id, lng, lat }) => JSON.stringify([String(id), lng, lat])).sort().join('\n') + '\n';
  await verifyChecksum(new TextEncoder().encode(payload), expected, cryptoImpl, 'runtime POI coordinate fingerprint');
}

function exactArrayBuffer(bytes) { return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }

export const spatialPackageTestHelpers = { validateManifest, verifyChecksum, verifyRuntimeFingerprint, exactArrayBuffer };
