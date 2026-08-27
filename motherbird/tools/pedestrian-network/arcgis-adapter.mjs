import { ArcGisClient } from '../federal-core/arcgis-client.mjs';

export async function fetchArcGisDataset(dataset, { fetchImpl = globalThis.fetch, envelope } = {}) {
  if (!dataset.service_url) throw new Error(`${dataset.id}: service_url is required`);
  const client = new ArcGisClient({ fetchImpl });
  const metadata = await client.layerMetadata(dataset.service_url, dataset.id);
  const objectIdField = metadata.objectIdField || metadata.objectIdFieldName || 'OBJECTID';
  const { features, stats } = await client.completeQuery(dataset.service_url, {
    where: dataset.where || '1=1',
    envelope,
    objectIdField,
    batchSize: Math.min(metadata.maxRecordCount || 500, 1000)
  }, dataset.id);
  return {
    featureCollection: { type: 'FeatureCollection', features },
    acquisition: {
      method: stats.method,
      object_id_field: objectIdField,
      object_id_count: stats.objectIdCount,
      batch_count: stats.batchCount,
      source_last_edit: arcGisTimestamp(metadata.editingInfo?.lastEditDate) || latestFeatureEdit(features, dataset.last_edit_fields),
      where: dataset.where || '1=1',
      envelope: envelope || null,
      service_crs: metadata.extent?.spatialReference?.latestWkid || metadata.extent?.spatialReference?.wkid || null,
      geometry_type: metadata.geometryType || null,
      max_record_count: metadata.maxRecordCount || null
    }
  };
}

function latestFeatureEdit(features, fields = ['last_edited_date']) {
  let latest = null;
  for (const feature of features) {
    for (const field of fields) {
      const value = feature.properties?.[field];
      const timestamp = typeof value === 'number' ? value : Date.parse(value);
      if (Number.isFinite(timestamp) && (!latest || timestamp > latest)) latest = timestamp;
    }
  }
  return latest ? new Date(latest).toISOString() : null;
}

function arcGisTimestamp(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}
