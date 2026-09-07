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
