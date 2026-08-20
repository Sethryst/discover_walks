import { fetchAdaptiveLayer } from './adaptive-tiles.mjs';

export async function acquireLayer(client, source, scope) {
  const where = source.scopeQueries?.[scope] || '1=1';
  if (source.adapter === 'tiger-arcgis') {
    return client.completeQuery(source.service, {
      where,
      batchSize: source.batchSize || 250,
      objectIdField: source.objectIdField || 'OBJECTID'
    }, source.id);
  }
  if (source.adapter === 'fema-nfhl-tiled') {
    const envelope = source.scopeEnvelopes?.[scope];
    if (!envelope) throw new Error(`${source.id}: no envelope is configured for scope ${scope}`);
    return fetchAdaptiveLayer(client, source, envelope, {
      where,
      outFields: source.outFields || '*',
      maxFeaturesPerTile: source.maxFeaturesPerTile,
      maxDepth: source.maxTileDepth,
      batchSize: source.batchSize
    });
  }
  throw new Error(`${source.id}: unsupported Federal Core adapter ${source.adapter}`);
}
