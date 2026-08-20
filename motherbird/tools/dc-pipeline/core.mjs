import { createHash } from 'node:crypto';
import { DC_BOUNDS, SNAPSHOT_DATE } from './config.mjs';

export function centroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return { lng: Number(geometry.coordinates[0]), lat: Number(geometry.coordinates[1]) };
  const points = [];
  const collect = (value) => {
    if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) points.push([Number(value[0]), Number(value[1])]);
    else if (Array.isArray(value)) value.forEach(collect);
  };
  collect(geometry.coordinates);
  if (!points.length) return null;
  return { lng: points.reduce((sum, point) => sum + point[0], 0) / points.length, lat: points.reduce((sum, point) => sum + point[1], 0) / points.length };
}

const first = (properties, fields) => fields.map((field) => properties?.[field]).find((value) => value !== undefined && value !== null && String(value).trim());
const slug = (value) => String(value || '').normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

export function normalizeSource(source, featureCollection, retrievedAt = SNAPSHOT_DATE) {
  return (featureCollection.features || []).map((feature, index) => {
    const properties = feature.properties || {};
    const location = centroid(feature.geometry);
    // Some official GIS layers use a numeric asset code as NAME. A source may
    // provide a transparent visitor-facing fallback without inventing a title.
    const sourceName = source.nameForFeature?.(properties, index);
    const name = sourceName || first(properties, source.nameFields) || `${source.title} ${index + 1}`;
    const sourceId = first(properties, ['GIS_ID', 'GLOBALID', 'OBJECTID', 'PLACE_NAME_ID', 'MAR_ID', 'STONE_NUM']) || feature.id || index + 1;
    const description = source.descriptionFields.map((field) => properties[field]).filter((value) => value !== undefined && value !== null && String(value).trim()).map(String).join(' · ');
    return {
      id: `dc-${slug(source.id)}-${slug(sourceId) || createHash('sha1').update(`${name}:${index}`).digest('hex').slice(0, 12)}`,
      name: String(name).trim(), category: source.category, tags: source.tags, lat: location?.lat, lng: location?.lng,
      radius: source.category === 'park' ? 75 : 50, description: description || 'Washington, DC',
      source: source.title, sourceId: String(sourceId), sourceUrl: source.serviceUrl || source.portalUrl,
      retrievedAt, confidence: 'high', sourceGeometryType: feature.geometry?.type || null
    };
  });
}

export const withinDc = (poi) => Number.isFinite(poi?.lat) && Number.isFinite(poi?.lng) && poi.lng >= DC_BOUNDS.west && poi.lng <= DC_BOUNDS.east && poi.lat >= DC_BOUNDS.south && poi.lat <= DC_BOUNDS.north;

function ringContains([lng, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(point, coordinates) {
  return coordinates?.length && ringContains(point, coordinates[0]) && !coordinates.slice(1).some((hole) => ringContains(point, hole));
}

export function geometryContains(point, geometry) {
  if (geometry?.type === 'Polygon') return polygonContains(point, geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => polygonContains(point, polygon));
  return false;
}

export function assignNeighborhoods(pois, clusters) {
  const polygons = (clusters.features || []).filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
  return pois.map((poi) => {
    const cluster = polygons.find((feature) => geometryContains([poi.lng, poi.lat], feature.geometry));
    const properties = cluster?.properties || {};
    const clusterId = properties.CLUSTER || properties.NAME || properties.OBJECTID || 'dc-no-neighborhood-cluster';
    const neighborhood = properties.NBH_NAMES || properties.NAME || properties.LABEL || 'Washington, DC (outside official neighborhood clusters)';
    return { ...poi, neighborhoodClusterId: String(clusterId), neighborhoodName: String(neighborhood) };
  });
}

function meters(a, b) {
  const rad = Math.PI / 180; const dLat = (b.lat - a.lat) * rad; const dLng = (b.lng - a.lng) * rad;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}
const normalizedName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\b(the|and|of|at|dc)\b/g, ' ').replace(/\s+/g, ' ').trim();

export function deduplicate(pois) {
  const kept = []; const merges = [];
  for (const poi of pois) {
    const name = normalizedName(poi.name);
    const duplicate = kept.find((candidate) => candidate.category === poi.category && normalizedName(candidate.name) === name && name.length > 3 && meters(candidate, poi) <= 50);
    if (!duplicate) kept.push(poi);
    else merges.push({ kept: duplicate.id, removed: poi.id, reason: 'same normalized name and category within 50m' });
  }
  return { pois: kept, report: { input: pois.length, kept: kept.length, merged: merges.length, examples: merges.slice(0, 20) } };
}

export function validatePois(pois, { requireNeighborhood = true } = {}) {
  const valid = []; const invalid = [];
  const ids = new Set();
  for (const poi of pois) {
    const errors = [];
    if (!poi?.id || typeof poi.id !== 'string') errors.push('missing id');
    else if (ids.has(poi.id)) errors.push('duplicate id'); else ids.add(poi.id);
    if (!poi?.name || typeof poi.name !== 'string') errors.push('missing name');
    if (!poi?.category || !Array.isArray(poi.tags) || !poi.tags.length) errors.push('missing category/tags');
    if (!withinDc(poi)) errors.push('coordinates outside configured DC boundary');
    if (!poi?.source || !poi?.retrievedAt) errors.push('missing provenance');
    if (poi.sourceUrl && !/^https:\/\//i.test(poi.sourceUrl)) errors.push('sourceUrl must use HTTPS');
    if (!['high', 'medium', 'low'].includes(poi.confidence)) errors.push('invalid confidence');
    if (requireNeighborhood && (!poi.neighborhoodClusterId || !poi.neighborhoodName)) errors.push('missing neighborhood assignment');
    if (errors.length) invalid.push({ id: poi?.id || '(missing)', errors }); else valid.push(poi);
  }
  return { valid, invalid };
}

export function poiStats(pois) {
  const count = (field) => Object.fromEntries([...pois.reduce((map, poi) => map.set(poi[field] || 'unknown', (map.get(poi[field] || 'unknown') || 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return { total: pois.length, byCategory: count('category'), bySource: count('source'), byNeighborhood: count('neighborhoodName'), byConfidence: count('confidence') };
}
