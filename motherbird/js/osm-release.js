const PRODUCTS = new Set(['roadway', 'poi']);

export async function fetchOsmReleaseManifest({
  url = globalThis.WALK_WILDLIFE_SUPABASE?.osmReleaseManifestUrl,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!url) throw new Error('No published OSM release manifest URL is configured.');
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`OSM release manifest request failed with HTTP ${response.status}.`);
  return response.json();
}

export function publishedStateProduct(manifest, stateId, product) {
  if (!PRODUCTS.has(product)) throw new Error(`Unknown OSM product: ${product}`);
  const state = manifest?.states?.[stateId];
  const artifact = state?.[product];
  if (!state || !artifact?.cloudAvailable || !artifact?.url) return null;
  return {
    state: { id: state.id, code: state.code, fips: state.fips, name: state.name, bbox: state.bbox },
    product,
    url: artifact.url,
    objectPath: artifact.objectPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    featureCount: artifact.featureCount,
    manifest: artifact
  };
}

export function publishedNationalPoi(manifest) {
  const artifact = manifest?.national?.poi;
  if (!artifact?.cloudAvailable || !artifact?.url) return null;
  const delivery = artifact.delivery || {};
  if (delivery.mode !== 'http_range'
      || delivery.fullDownloadAllowed !== false
      || delivery.offlineInstallable !== false
      || delivery.requiresAcceptRangesBytes !== true) {
    throw new Error('National POI manifest does not enforce range-only delivery.');
  }
  return {
    product: 'national-poi',
    url: artifact.url,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    featureCount: artifact.featureCount,
    manifest: artifact
  };
}

export function createNationalPoiArchive(manifest, { pmtilesImpl = globalThis.pmtiles } = {}) {
  const published = publishedNationalPoi(manifest);
  if (!published) return null;
  if (!pmtilesImpl?.FetchSource || !pmtilesImpl?.PMTiles) {
    throw new Error('The PMTiles range reader is unavailable.');
  }
  // FetchSource issues bounded HTTP Range requests. There is deliberately no
  // Blob/full-fetch fallback for the national archive.
  const source = new pmtilesImpl.FetchSource(published.url);
  return { ...published, archive: new pmtilesImpl.PMTiles(source) };
}

export async function downloadPublishedStateProduct(manifest, stateId, product, { fetchImpl = globalThis.fetch } = {}) {
  const published = publishedStateProduct(manifest, stateId, product);
  if (!published) throw new Error(`${stateId} ${product} is not available in the published release.`);
  const response = await fetchImpl(published.url, { headers: { Accept: 'application/vnd.pmtiles' } });
  if (!response.ok) throw new Error(`${stateId} ${product} download failed with HTTP ${response.status}.`);
  const blob = await response.blob();
  if (Number.isFinite(published.bytes) && blob.size !== published.bytes) {
    throw new Error(`${stateId} ${product} download size does not match the release manifest.`);
  }
  return { ...published, blob };
}
