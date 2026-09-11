import { haversineMeters } from './graph-builder.mjs';

const PEDESTRIAN_HIGHWAYS = new Set(['footway', 'path', 'pedestrian', 'steps', 'corridor', 'living_street', 'track', 'bridleway']);
const ROAD_HIGHWAYS = new Set(['residential', 'unclassified', 'service', 'tertiary', 'secondary', 'primary', 'road', 'tertiary_link', 'secondary_link', 'primary_link']);
const ACCESS_ALLOWED = new Set(['yes', 'designated', 'official']);
const ACCESS_PROHIBITED = new Set(['no', 'private']);
const INTERNAL_FIELDS = [
  '_mb_source_feature_id', '_mb_source_dataset_id', '_mb_edge_type', '_mb_access', '_mb_access_evidence',
  '_mb_confidence', '_mb_policy_confidence', '_mb_policy_warning', '_mb_derived_from_raw_feature_ids',
  '_mb_source_priority', '_mb_access_conflict', '_mb_source_raw_access', '_mb_merge_status', '_mb_area_geometry',
  '_mb_preserve_source_segments'
];

export function createRegionalDataset(config) {
  const id = `${config.id.replaceAll('-', '_')}_walk_network`;
  return {
    id,
    name: `${config.name} pedestrian network`,
    owner: 'Mother Bird regional pedestrian-network producer',
    jurisdiction: config.name,
    runtime_city: config.id,
    preserve_source_segments: false,
    default_edge_type: 'footpath',
    default_access: 'unknown',
    source_id_fields: ['_mb_source_feature_id'],
    classification_fields: ['_mb_edge_type'],
    access_fields: ['_mb_access'],
    edge_attribute_fields: [...INTERNAL_FIELDS, 'osm_id', 'osm_type', 'highway', 'footway', 'sidewalk', 'crossing', 'barrier', 'access', 'foot', 'access:conditional', 'surface', 'width', 'name', 'TYPE', 'SOURCE', 'SURFACE_TYPE', 'GlobalID', 'OBJECTID']
  };
}

export function normalizeAuthoritative(collection, source) {
  const features = [];
  for (const [index, feature] of collection.features.entries()) {
    if (!['LineString', 'MultiLineString'].includes(feature?.geometry?.type)) continue;
    const properties = feature.properties || {};
    const sourceId = first(properties, source.sourceIdFields || ['GlobalID', 'GLOBALID', 'OBJECTID', 'ObjectID']) ?? feature.id ?? `generated-${index}`;
    const classification = String(first(properties, source.classificationFields || ['TYPE', 'Type', 'type', 'FEAT_TYPE']) || '').toLowerCase();
    const edgeType = authoritativeEdgeType(classification, source.defaultEdgeType);
    const rawAccess = String(first(properties, source.accessFields || ['ACCESS', 'access', 'PUBLIC_ACCESS']) || '').toLowerCase();
    const access = normalizeAccess(rawAccess, source.defaultAccess || 'unknown');
    features.push(withMotherBirdProperties(feature, {
      ...properties,
      _mb_source_feature_id: `${source.id}:${sourceId}`,
      _mb_source_dataset_id: source.id,
      _mb_edge_type: edgeType,
      _mb_access: access,
      _mb_source_raw_access: rawAccess || null,
      _mb_access_evidence: access === 'unknown' ? 'municipal_pedestrian_network' : access === 'allowed' ? 'explicit_public' : 'explicit_private',
      _mb_confidence: 'authoritative_source_geometry',
      _mb_policy_confidence: access === 'unknown' ? 0.8 : 1,
      _mb_source_priority: 'authoritative',
      _mb_preserve_source_segments: source.preserveSourceSegments !== false,
      _mb_merge_status: 'authoritative_primary'
    }));
  }
  return features;
}

export function normalizeOsm(collection, source = { id: 'openstreetmap' }, { includeRoadCenterlines = true } = {}) {
  const network = [];
  const barriers = [];
  const skipped = [];
  for (const [index, feature] of collection.features.entries()) {
    const properties = feature.properties || {};
    const osmIdentity = osmId(feature, properties, index);
    const highway = String(properties.highway || '').toLowerCase();
    const barrier = String(properties.barrier || '').toLowerCase();
    if (feature.geometry?.type === 'Point' && (barrier || highway === 'crossing')) {
      barriers.push(withMotherBirdProperties(feature, {
        ...properties,
        osm_id: osmIdentity,
        osm_type: osmIdentity.split('/')[0],
        _mb_source_feature_id: `osm:${osmIdentity}`,
        _mb_source_dataset_id: source.id || 'openstreetmap',
        _mb_source_priority: 'osm_supplement'
      }));
      continue;
    }
    if (!['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
      skipped.push({ source_feature_id: `osm:${osmIdentity}`, reason: 'unsupported_geometry', tags: relevantOsmTags(properties) });
      continue;
    }
    if (barrier && !highway) {
      barriers.push(withMotherBirdProperties(feature, {
        ...properties,
        osm_id: osmIdentity,
        osm_type: osmIdentity.split('/')[0],
        _mb_source_feature_id: `osm:${osmIdentity}`,
        _mb_source_dataset_id: source.id || 'openstreetmap',
        _mb_source_priority: 'osm_supplement'
      }));
      continue;
    }
    const classification = classifyOsm(properties, { includeRoadCenterlines });
    if (!classification) {
      skipped.push({ source_feature_id: `osm:${osmIdentity}`, reason: highway ? 'non_walkable_highway' : 'missing_required_walkable_tags', tags: relevantOsmTags(properties) });
      continue;
    }
    const access = osmAccess(properties);
    const conditional = properties['access:conditional'] || properties['foot:conditional'];
    const inferred = classification.evidence.startsWith('osm_inferred');
    const warning = conditional
      ? `Conditional OSM access is preserved for review: ${conditional}`
      : inferred ? 'Pedestrian access is inferred from OSM highway tags; this geometry has not been independently verified.' : null;
    network.push(withMotherBirdProperties(feature, {
      ...properties,
      osm_id: osmIdentity,
      osm_type: osmIdentity.split('/')[0],
      _mb_source_feature_id: `osm:${osmIdentity}`,
      _mb_source_dataset_id: source.id || 'openstreetmap',
      _mb_edge_type: classification.edgeType,
      _mb_access: conditional && access === 'allowed' ? 'unknown' : access,
      _mb_source_raw_access: properties.foot ?? properties.access ?? null,
      _mb_access_evidence: conditional ? 'conditional_osm_access' : classification.evidence,
      _mb_confidence: classification.confidence,
      _mb_policy_confidence: access === 'prohibited' ? 1 : classification.policyConfidence,
      _mb_policy_warning: warning,
      _mb_source_priority: 'osm_supplement',
      _mb_preserve_source_segments: false,
      _mb_merge_status: 'osm_supplement'
    }));
  }
  if (!network.length) throw new Error('OSM source has no walkable features with required highway/footway/sidewalk/crossing/access tags.');
  return { network, barriers, skipped };
}

export function mergeAuthoritativeAndOsm(authoritative, osm, { overlapToleranceMeters = 2 } = {}) {
  const authoritativeIndex = buildSegmentIndex(authoritative);
  const acceptedOsm = [];
  const overlaps = [];
  const conflicts = [];
  for (const osmFeature of osm) {
    const match = findOverlap(osmFeature, authoritativeIndex, overlapToleranceMeters);
    if (!match || osmFeature.properties._mb_edge_type === 'crossing') {
      acceptedOsm.push(osmFeature);
      continue;
    }
    const osmAccess = osmFeature.properties._mb_access;
    const authoritativeAccess = match.properties._mb_access;
    const contradicts = (osmAccess === 'prohibited' && authoritativeAccess !== 'prohibited')
      || (authoritativeAccess === 'prohibited' && osmAccess !== 'prohibited');
    const record = {
      authoritative_source_feature_id: match.properties._mb_source_feature_id,
      osm_source_feature_id: osmFeature.properties._mb_source_feature_id,
      authoritative_access: authoritativeAccess,
      osm_access: osmAccess,
      distance_m: match._mb_match_distance_m
    };
    if (contradicts) {
      markConflict(match, osmFeature, record);
      conflicts.push(record);
      acceptedOsm.push(osmFeature);
    } else {
      match.properties._mb_merge_status = 'authoritative_with_osm_overlap';
      match.properties._mb_supplemental_osm_id = osmFeature.properties.osm_id;
      match.properties._mb_supplemental_access = osmAccess;
      overlaps.push(record);
    }
  }
  return { features: [...authoritative, ...acceptedOsm], overlaps, conflicts };
}

export function applyOsmBarrierRestrictions(network, barriers, { toleranceMeters = 0.75 } = {}) {
  const restricted = [];
  const restrictivePoints = barriers.filter((feature) => feature.geometry?.type === 'Point' && barrierBlocksWalking(feature.properties || {}));
  for (const barrier of restrictivePoints) {
    let best = null;
    for (const feature of network) {
      for (const [start, end] of segments(feature.geometry)) {
        const distance = pointSegmentDistanceMeters(barrier.geometry.coordinates, start, end);
        if (distance <= toleranceMeters && (!best || distance < best.distance_m)) best = { feature, distance_m: distance };
      }
    }
    if (!best) continue;
    const properties = best.feature.properties;
    properties._mb_source_raw_access = properties._mb_source_raw_access ?? properties.foot ?? properties.access ?? null;
    properties._mb_access = 'prohibited';
    properties._mb_access_evidence = 'explicit_osm_restrictive_barrier';
    properties._mb_policy_confidence = 1;
    properties._mb_policy_warning = `OSM ${barrier.properties.barrier || 'barrier'} ${barrier.properties._mb_source_feature_id} explicitly restricts pedestrian access.`;
    properties._mb_merge_status = 'blocked_by_osm_barrier';
    restricted.push({
      barrier_source_feature_id: barrier.properties._mb_source_feature_id,
      network_source_feature_id: properties._mb_source_feature_id,
      distance_m: Math.round(best.distance_m * 100) / 100
    });
  }
  return restricted;
}

function markConflict(authoritative, osm, record) {
  const warning = `Conflicting access evidence between ${record.authoritative_source_feature_id} and ${record.osm_source_feature_id}; cautiously blocked pending review.`;
  for (const feature of [authoritative, osm]) {
    feature.properties._mb_access_conflict = true;
    feature.properties._mb_access = 'prohibited';
    feature.properties._mb_access_evidence = 'conflicting_sources_cautious_block';
    feature.properties._mb_policy_warning = warning;
    feature.properties._mb_policy_confidence = 0.35;
    feature.properties._mb_merge_status = 'access_conflict_blocked';
  }
}

function classifyOsm(properties, { includeRoadCenterlines }) {
  const highway = String(properties.highway || '').toLowerCase();
  const footway = String(properties.footway || '').toLowerCase();
  const area = String(properties.area || '').toLowerCase();
  const sidewalk = String(properties.sidewalk || '').toLowerCase();
  const crossing = properties.crossing || properties.crossing_ref;
  if (footway === 'crossing' || crossing || highway === 'crossing') return { edgeType: 'crossing', evidence: 'explicit_osm_crossing', confidence: 'osm_source_explicit', policyConfidence: 0.9 };
  if (highway === 'pedestrian' && area === 'yes') return { edgeType: 'pedestrian_plaza', evidence: 'explicit_osm_pedestrian_area', confidence: 'osm_source_explicit', policyConfidence: 0.9 };
  if (highway === 'footway') return { edgeType: 'footpath', evidence: 'explicit_osm_footway', confidence: 'osm_source_explicit', policyConfidence: 0.9 };
  if (['path', 'bridleway'].includes(highway)) return { edgeType: 'footpath', evidence: 'osm_inferred_path_access', confidence: 'osm_source_tagged', policyConfidence: 0.7 };
  if (highway === 'track') return { edgeType: 'trail', evidence: 'osm_inferred_trail_access', confidence: 'osm_source_tagged', policyConfidence: 0.65 };
  if (highway === 'steps' || highway === 'corridor') return { edgeType: 'pedestrian_link', evidence: 'explicit_osm_pedestrian_link', confidence: 'osm_source_explicit', policyConfidence: 0.85 };
  if (highway === 'living_street') return { edgeType: 'pedestrian_link', evidence: 'osm_inferred_walkable_road', confidence: 'osm_source_tagged', policyConfidence: 0.6 };
  if (ROAD_HIGHWAYS.has(highway) && includeRoadCenterlines) {
    if (['yes', 'both', 'left', 'right'].includes(sidewalk)) return { edgeType: 'sidewalk', evidence: 'osm_inferred_road_centerline_with_sidewalk', confidence: 'osm_inferred_geometry', policyConfidence: 0.55 };
    if (sidewalk === 'separate' && !ACCESS_ALLOWED.has(String(properties.foot || '').toLowerCase())) return null;
    return { edgeType: 'pedestrian_link', evidence: 'osm_inferred_walkable_road', confidence: 'osm_inferred_geometry', policyConfidence: 0.45 };
  }
  return PEDESTRIAN_HIGHWAYS.has(highway)
    ? { edgeType: 'footpath', evidence: 'osm_inferred_path_access', confidence: 'osm_source_tagged', policyConfidence: 0.65 }
    : null;
}

function osmAccess(properties) {
  const value = String(properties.foot ?? properties.access ?? '').toLowerCase();
  if (ACCESS_PROHIBITED.has(value)) return 'prohibited';
  if (ACCESS_ALLOWED.has(value)) return 'allowed';
  if (value === 'permissive' || value === 'destination' || value === 'customers') return 'unknown';
  return 'unknown';
}

function barrierBlocksWalking(properties) {
  const access = String(properties.foot ?? properties.access ?? '').toLowerCase();
  if (ACCESS_PROHIBITED.has(access)) return true;
  return ['wall', 'fence', 'retaining_wall'].includes(String(properties.barrier || '').toLowerCase()) && !ACCESS_ALLOWED.has(access);
}

function authoritativeEdgeType(value, fallback = 'sidewalk') {
  if (value.includes('cross')) return 'crossing';
  if (value.includes('trail')) return 'trail';
  if (value.includes('connector') || value.includes('link')) return 'pedestrian_link';
  if (value.includes('path')) return 'footpath';
  return fallback;
}

function normalizeAccess(value, fallback) {
  if (ACCESS_PROHIBITED.has(value) || value === 'restricted') return 'prohibited';
  if (ACCESS_ALLOWED.has(value) || value === 'public') return 'allowed';
  return ['allowed', 'prohibited', 'unknown'].includes(fallback) ? fallback : 'unknown';
}

function withMotherBirdProperties(feature, properties) {
  return { type: 'Feature', id: feature.id, geometry: feature.geometry, properties };
}

function osmId(feature, properties, index) {
  const raw = properties['@id'] ?? properties.osm_id ?? feature.id;
  if (raw !== undefined && raw !== null && String(raw).trim()) {
    const value = String(raw);
    if (/^(node|way|relation)\//.test(value)) return value;
    const type = feature.geometry?.type === 'Point' ? 'node' : 'way';
    return `${type}/${value}`;
  }
  return `generated/${index}`;
}

function relevantOsmTags(properties) {
  return Object.fromEntries(['highway', 'footway', 'sidewalk', 'crossing', 'crossing_ref', 'barrier', 'access', 'foot', 'access:conditional', 'foot:conditional', 'area']
    .filter((key) => properties[key] !== undefined)
    .map((key) => [key, properties[key]]));
}

function first(properties, fields) {
  for (const field of fields) if (properties[field] !== undefined && properties[field] !== null && String(properties[field]).trim()) return properties[field];
  return null;
}

function buildSegmentIndex(features) {
  const cellSize = 0.0001;
  const cells = new Map();
  for (const feature of features) {
    for (const [start, end] of segments(feature.geometry)) {
      const minX = Math.floor(Math.min(start[0], end[0]) / cellSize) - 1;
      const maxX = Math.floor(Math.max(start[0], end[0]) / cellSize) + 1;
      const minY = Math.floor(Math.min(start[1], end[1]) / cellSize) - 1;
      const maxY = Math.floor(Math.max(start[1], end[1]) / cellSize) + 1;
      for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        (cells.get(key) || cells.set(key, []).get(key)).push({ feature, start, end });
      }
    }
  }
  return { cells, cellSize };
}

function findOverlap(feature, index, tolerance) {
  const coordinates = lineParts(feature.geometry).flat();
  if (!coordinates.length) return null;
  const probe = coordinates[Math.floor(coordinates.length / 2)];
  const x = Math.floor(probe[0] / index.cellSize);
  const y = Math.floor(probe[1] / index.cellSize);
  let best = null;
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
    for (const candidate of index.cells.get(`${x + dx}:${y + dy}`) || []) {
      if (candidate.feature.properties._mb_edge_type !== feature.properties._mb_edge_type) continue;
      const distance = pointSegmentDistanceMeters(probe, candidate.start, candidate.end);
      if (distance <= tolerance && (!best || distance < best._mb_match_distance_m)) best = { ...candidate.feature, _mb_match_distance_m: Math.round(distance * 100) / 100 };
    }
  }
  return best;
}

function pointSegmentDistanceMeters(point, start, end) {
  const lat = point[1] * Math.PI / 180;
  const sx = (start[0] - point[0]) * Math.cos(lat) * 111_320;
  const sy = (start[1] - point[1]) * 110_540;
  const ex = (end[0] - point[0]) * Math.cos(lat) * 111_320;
  const ey = (end[1] - point[1]) * 110_540;
  const dx = ex - sx; const dy = ey - sy;
  const t = dx || dy ? Math.max(0, Math.min(1, -(sx * dx + sy * dy) / (dx * dx + dy * dy))) : 0;
  const projected = [point[0] + (sx + dx * t) / (Math.cos(lat) * 111_320), point[1] + (sy + dy * t) / 110_540];
  return haversineMeters(point, projected);
}

function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function segments(geometry) {
  return lineParts(geometry).flatMap((coordinates) => coordinates.slice(0, -1).map((coordinate, index) => [coordinate, coordinates[index + 1]]));
}
