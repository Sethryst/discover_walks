function split([xmin, ymin, xmax, ymax]) {
  const xmid = (xmin + xmax) / 2;
  const ymid = (ymin + ymax) / 2;
  return [
    [xmin, ymin, xmid, ymid],
    [xmid, ymin, xmax, ymid],
    [xmin, ymid, xmid, ymax],
    [xmid, ymid, xmax, ymax]
  ];
}

/** Resolve a large spatial layer into queryable leaves. */
export async function planAdaptiveTiles(client, source, envelope, {
  where = '1=1',
  maxFeaturesPerTile = 1_500,
  maxDepth = 12
} = {}) {
  const leaves = [];
  let countQueries = 0;

  async function visit(tile, depth, key) {
    const count = await client.count(source.service, { where, envelope: tile }, `${source.id} tile ${key}`);
    countQueries += 1;
    if (count === 0) return;
    if (count <= maxFeaturesPerTile) {
      leaves.push({ key, envelope: tile, count, depth });
      return;
    }
    if (depth >= maxDepth) {
      throw new Error(`${source.id}: tile ${key} still has ${count} features at maximum depth ${maxDepth}`);
    }
    const children = split(tile);
    for (let index = 0; index < children.length; index += 1) {
      await visit(children[index], depth + 1, `${key}.${index}`);
    }
  }

  await visit(envelope, 0, '0');
  return { leaves, countQueries };
}

export async function fetchAdaptiveLayer(client, source, envelope, options = {}) {
  const plan = await planAdaptiveTiles(client, source, envelope, options);
  const ids = new Set();
  let tileObjectIdCount = 0;
  for (const tile of plan.leaves) {
    const tileIds = await client.objectIds(source.service, { where: options.where, envelope: tile.envelope }, `${source.id} tile ${tile.key}`);
    if (tileIds.length !== tile.count) {
      throw new Error(`${source.id}: tile ${tile.key} count changed during acquisition (${tile.count} to ${tileIds.length})`);
    }
    tileObjectIdCount += tileIds.length;
    tileIds.forEach((id) => ids.add(id));
  }
  const objectIds = [...ids];
  const batchSize = options.batchSize || 250;
  const features = await client.featuresByIds(source.service, objectIds, {
    outFields: options.outFields || '*',
    batchSize,
    objectIdField: source.objectIdField || 'OBJECTID'
  }, source.id);
  return {
    features,
    stats: {
      method: 'adaptive-envelope-tiles-plus-object-id-batches',
      tileCount: plan.leaves.length,
      countQueries: plan.countQueries,
      tileObjectIdCount,
      uniqueObjectIdCount: objectIds.length,
      duplicateTileHitsRemoved: tileObjectIdCount - objectIds.length,
      batchCount: Math.ceil(objectIds.length / batchSize),
      envelope
    }
  };
}
