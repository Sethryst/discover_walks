import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { planAdaptiveTiles } from './adaptive-tiles.mjs';
import { compileLayer, sha256 } from './artifact-contract.mjs';

/**
 * Write a nationwide layer as independently verifiable shards. A feature may
 * occur in adjacent shards when it crosses a tile edge; regional installers
 * deduplicate on boundary_id after selecting all intersecting tiles.
 */
export async function writeTiledArtifact(client, source, scope, generatedAt, outputRoot, sourceMetadata = null) {
  const envelope = source.scopeEnvelopes?.[scope];
  if (!envelope) throw new Error(`${source.id}: no envelope is configured for scope ${scope}`);
  const where = source.scopeQueries?.[scope] || '1=1';
  const plan = await planAdaptiveTiles(client, source, envelope, {
    where,
    maxFeaturesPerTile: source.maxFeaturesPerTile,
    maxDepth: source.maxTileDepth
  });
  const tileDirectory = path.join(outputRoot, source.id, 'tiles');
  await mkdir(tileDirectory, { recursive: true });
  const tiles = [];
  let tileFeatureCount = 0;

  for (const tile of plan.leaves) {
    const ids = await client.objectIds(source.service, { where, envelope: tile.envelope }, `${source.id} tile ${tile.key}`);
    if (ids.length !== tile.count) {
      throw new Error(`${source.id}: tile ${tile.key} count changed during acquisition (${tile.count} to ${ids.length})`);
    }
    const features = await client.featuresByIds(source.service, ids, {
      outFields: source.outFields || '*',
      batchSize: source.batchSize,
      objectIdField: source.objectIdField || 'OBJECTID'
    }, `${source.id} tile ${tile.key}`);
    const acquisition = {
      method: 'adaptive-envelope-tile-plus-object-id-batches',
      tileKey: tile.key,
      envelope: tile.envelope,
      objectIdCount: ids.length
    };
    const artifact = compileLayer(source, scope, generatedAt, features, acquisition);
    const filename = `tile-${tile.key.replaceAll('.', '-')}.geojson`;
    const relativeFilename = `${source.id}/tiles/${filename}`;
    const payload = `${JSON.stringify(artifact)}\n`;
    await writeFile(path.join(tileDirectory, filename), payload);
    tiles.push({ key: tile.key, envelope: tile.envelope, filename: relativeFilename, featureCount: artifact.features.length, checksum: sha256(payload) });
    tileFeatureCount += artifact.features.length;
  }

  const index = {
    schemaVersion: 1,
    artifactType: 'federal-boundary-tile-index',
    scope,
    generatedAt,
    sourceId: source.id,
    sourceUrl: source.service,
    vintage: source.vintage,
    rootEnvelope: envelope,
    tiling: {
      method: 'adaptive-envelope-quadtree',
      maxFeaturesPerTile: source.maxFeaturesPerTile,
      countQueries: plan.countQueries,
      edgePolicy: 'features crossing edges may appear in multiple tiles',
      installDeduplicationKey: 'boundary_id'
    },
    tileFeatureCount,
    uniqueFeatureCount: null,
    tiles
  };
  const filename = `${source.id}-index.json`;
  const payload = `${JSON.stringify(index, null, 2)}\n`;
  await writeFile(path.join(outputRoot, filename), payload);
  return {
    id: source.id,
    filename,
    format: 'adaptive-tiled-geojson-index',
    featureCount: tileFeatureCount,
    uniqueFeatureCount: null,
    tileCount: tiles.length,
    checksum: sha256(payload),
    vintage: source.vintage,
    sourceUrl: source.service,
    acquisition: { method: 'adaptive-envelope-tiled-artifact', countQueries: plan.countQueries, rootEnvelope: envelope, sourceMetadata }
  };
}
