import { createHash } from 'node:crypto';

export const sha256 = (payload) => `sha256:${createHash('sha256').update(payload).digest('hex')}`;

export function geometryBounds(geometry) {
  const bounds = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity, count: 0 };
  collectPositions(geometry?.coordinates, bounds);
  if (!bounds.count) throw new Error(`Unsupported or empty geometry: ${geometry?.type || 'missing'}`);
  return [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax];
}

function collectPositions(value, bounds) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    bounds.xmin = Math.min(bounds.xmin, value[0]);
    bounds.ymin = Math.min(bounds.ymin, value[1]);
    bounds.xmax = Math.max(bounds.xmax, value[0]);
    bounds.ymax = Math.max(bounds.ymax, value[1]);
    bounds.count += 1;
    return;
  }
  value.forEach((child) => collectPositions(child, bounds));
}

export function normalizeFeature(source, feature) {
  const properties = feature.properties || {};
  const sourceKey = String(properties[source.idField] ?? '').trim();
  if (!sourceKey || !feature.geometry) throw new Error(`${source.id}: missing stable id or geometry`);
  const provider = source.adapter === 'fema-nfhl-tiled' ? 'fema-nfhl-arcgis-v1' : 'tigerweb-arcgis-v2';
  const prefix = source.adapter === 'fema-nfhl-tiled' ? 'fema' : 'tiger';
  const boundaryId = `${prefix}_${source.boundaryType}_${source.vintage}_${sourceKey}`;
  const nameValue = properties[source.nameField] ?? properties[source.idField];
  return {
    type: 'Feature',
    id: boundaryId,
    properties: {
      boundary_id: boundaryId,
      boundary_type: source.boundaryType,
      name: String(nameValue),
      geometry_hash: sha256(JSON.stringify(feature.geometry)),
      bbox: geometryBounds(feature.geometry),
      source_authority: source.authority,
      source_url: source.service,
      vintage: source.vintage,
      provider_version: provider,
      schema_version: 1,
      classification: source.classification,
      source_properties: properties
    },
    geometry: feature.geometry
  };
}

export function compileLayer(source, scope, generatedAt, features, acquisition) {
  const normalized = features.map((feature) => normalizeFeature(source, feature));
  normalized.sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Set();
  for (const feature of normalized) {
    if (seen.has(feature.id)) throw new Error(`${source.id}: duplicate stable boundary id ${feature.id}`);
    seen.add(feature.id);
  }
  return {
    type: 'FeatureCollection',
    metadata: {
      schemaVersion: 1,
      artifactType: 'federal-boundary-layer',
      scope,
      generatedAt,
      sourceId: source.id,
      provenance: { authority: source.authority, service: source.service, vintage: source.vintage, provider: normalized[0]?.properties.provider_version },
      acquisition
    },
    features: normalized
  };
}
