export async function fetchGeoJsonDataset(dataset, { fetchImpl = globalThis.fetch } = {}) {
  if (!dataset.geojson_download_url) throw new Error(`${dataset.id}: geojson_download_url is required`);
  const response = await fetchImpl(dataset.geojson_download_url, {
    headers: { Accept: 'application/geo+json, application/json', 'User-Agent': 'MotherBird-pedestrian-network/1.0' },
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) throw new Error(`${dataset.id}: download returned ${response.status} ${response.statusText}`.trim());
  const featureCollection = await response.json();
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new Error(`${dataset.id}: download did not return a GeoJSON FeatureCollection`);
  }
  return {
    featureCollection,
    acquisition: {
      method: 'direct_geojson_download',
      source_last_edit: response.headers.get('last-modified'),
      service_crs: 4326,
      content_etag: response.headers.get('etag')
    }
  };
}
