import { createHash } from 'node:crypto';
import { evidenceFor, materializeAccessPolicy } from './access-policy.mjs';

const EARTH_RADIUS_M = 6_371_008.8;
const ALLOWED_EDGE_TYPES = new Set(['sidewalk', 'footpath', 'crossing', 'trail', 'pedestrian_plaza', 'indoor_pathway', 'pedestrian_link']);

export function buildPedestrianGraph(featureCollection, dataset, { snapToleranceMeters = 0.75 } = {}) {
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new TypeError('Expected a GeoJSON FeatureCollection');
  }
  if (!Number.isFinite(snapToleranceMeters) || snapToleranceMeters < 0 || snapToleranceMeters > 2) {
    throw new RangeError('snapToleranceMeters must be between 0 and 2');
  }

  const rejected = [];
  const rawFeatures = [];
  const candidates = [];
  for (const [featureIndex, feature] of featureCollection.features.entries()) {
    const sourceId = sourceFeatureId(feature, dataset, featureIndex);
    const lines = lineParts(feature?.geometry);
    if (!lines.length) {
      rejected.push({ source_feature_id: sourceId, reason: 'geometry_is_not_line' });
      continue;
    }
    const edgeType = classifyEdge(feature.properties || {}, dataset);
    const access = classifyAccess(feature.properties || {}, edgeType, dataset);
    const accessEvidence = feature.properties?._mb_access_evidence
      || evidenceFor(feature.properties || {}, dataset, edgeType, access);
    rawFeatures.push({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        registry_id: dataset.id,
        source_segment_id: sourceId,
        retrieved_crs: 'EPSG:4326'
      }
    });
    for (const [partIndex, coordinates] of lines.entries()) {
      const preserveSourceSegment = feature.properties?._mb_preserve_source_segments ?? dataset.preserve_source_segments;
      if (preserveSourceSegment) {
        const normalized = coordinates.map(validCoordinate);
        if (normalized.length < 2 || normalized.some((coordinate) => !coordinate)) {
          rejected.push({ source_feature_id: sourceId, part_index: partIndex, reason: 'invalid_source_linestring' });
          continue;
        }
        if (normalized.every((coordinate) => sameCoordinate(coordinate, normalized[0]))) {
          rejected.push({ source_feature_id: sourceId, part_index: partIndex, reason: 'zero_length_source_linestring' });
          continue;
        }
        candidates.push({
          sourceId,
          edgeId: feature.properties?._mb_edge_id,
          partIndex,
          segmentIndex: 0,
          from: normalized[0],
          to: normalized.at(-1),
          coordinates: normalized,
          edgeType,
          access,
          accessEvidence,
          attributes: selectAttributes(feature.properties || {}, dataset.edge_attribute_fields),
          updatedAt: featureUpdatedAt(feature.properties || {}, dataset.last_edit_fields)
        });
        continue;
      }
      for (let segmentIndex = 0; segmentIndex < coordinates.length - 1; segmentIndex += 1) {
        const from = validCoordinate(coordinates[segmentIndex]);
        const to = validCoordinate(coordinates[segmentIndex + 1]);
        if (!from || !to || sameCoordinate(from, to)) {
          rejected.push({ source_feature_id: sourceId, part_index: partIndex, segment_index: segmentIndex, reason: 'invalid_or_zero_length_segment' });
          continue;
        }
        candidates.push({ sourceId, edgeId: feature.properties?._mb_edge_id, partIndex, segmentIndex, from, to, coordinates: [from, to], edgeType, access, accessEvidence, attributes: selectAttributes(feature.properties || {}, dataset.edge_attribute_fields), updatedAt: featureUpdatedAt(feature.properties || {}, dataset.last_edit_fields) });
      }
    }
  }

  const clustered = clusterCoordinates(candidates.flatMap(({ from, to }) => [from, to]), snapToleranceMeters);
  const nodeByKey = new Map();
  const edges = candidates.map((candidate, candidateIndex) => {
    const from = clustered[candidateIndex * 2];
    const to = clustered[candidateIndex * 2 + 1];
    const fromNodeId = nodeId(dataset.id, from);
    const toNodeId = nodeId(dataset.id, to);
    ensureNode(nodeByKey, fromNodeId, from);
    ensureNode(nodeByKey, toNodeId, to);
    const edgeId = candidate.edgeId || `${dataset.id}:${candidate.sourceId}:${candidate.partIndex}:${candidate.segmentIndex}`;
    const policy = materializeAccessPolicy({ access: candidate.access, edgeType: candidate.edgeType, evidence: candidate.accessEvidence, attributes: candidate.attributes });
    const policyWarning = candidate.attributes._mb_policy_warning || policy.policy_warning;
    return {
      edge_id: edgeId,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      geometry: { type: 'LineString', coordinates: candidate.coordinates },
      edge_type: candidate.edgeType,
      access: candidate.access,
      routable: policy.routability.ordinary_walking_beta,
      ...policy,
      policy_confidence: Number.isFinite(candidate.attributes._mb_policy_confidence)
        ? candidate.attributes._mb_policy_confidence
        : policy.policy_confidence,
      policy_warning: policyWarning,
      source_dataset_id: candidate.attributes._mb_source_dataset_id || dataset.id,
      source_feature_id: candidate.sourceId,
      derived_from_raw_feature_ids: candidate.attributes._mb_derived_from_raw_feature_ids || [candidate.sourceId],
      confidence: candidate.attributes._mb_confidence || dataset.source_validation || (candidate.edgeType === 'crossing' ? 'source_explicit' : 'source_geometry'),
      last_verified_at: null,
      updated_at: candidate.updatedAt,
      length_m: round(lineLengthMeters(candidate.coordinates), 3),
      ...(Object.keys(candidate.attributes).length ? { source_attributes: candidate.attributes } : {})
    };
  });

  const incident = new Map();
  for (const edge of edges) {
    addIncident(incident, edge.from_node_id, edge);
    addIncident(incident, edge.to_node_id, edge);
  }
  const nodes = [...nodeByKey.values()].map((node) => ({
    ...node,
    node_type: nodeType(incident.get(node.node_id) || []),
    degree: (incident.get(node.node_id) || []).length,
    source_ids: [...new Set((incident.get(node.node_id) || []).map(({ source_feature_id }) => source_feature_id))].sort()
  })).sort((a, b) => a.node_id.localeCompare(b.node_id));

  return {
    raw: { type: 'FeatureCollection', features: rawFeatures },
    nodes,
    edges,
    rejected,
    snap_tolerance_m: snapToleranceMeters
  };
}

// Contract only ordinary degree-two corridors. Junctions, endpoints, crossings,
// access changes, and profile changes remain explicit, so shortest-path costs
// and legal turn choices are unchanged while coordinate bloat is removed.
export function contractDegreeTwoGraph(graph) {
  const edges = graph.edges.map((edge) => ({ ...edge, geometry: { ...edge.geometry, coordinates: edge.geometry.coordinates.map((point) => [...point]) }, derived_from_raw_feature_ids: [...(edge.derived_from_raw_feature_ids || [edge.source_feature_id])] }));
  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  let changed = true;
  while (changed) {
    changed = false;
    const incident = new Map();
    for (const edge of edges) {
      incident.set(edge.from_node_id, [...(incident.get(edge.from_node_id) || []), edge]);
      incident.set(edge.to_node_id, [...(incident.get(edge.to_node_id) || []), edge]);
    }
    for (const [nodeId, touching] of incident) {
      const node = nodeById.get(nodeId);
      if (!node || touching.length !== 2 || touching[0] === touching[1]) continue;
      const [left, right] = touching;
      if (!sameContractionClass(left, right)) continue;
      const leftOther = left.from_node_id === nodeId ? left.to_node_id : left.from_node_id;
      const rightOther = right.from_node_id === nodeId ? right.to_node_id : right.from_node_id;
      if (leftOther === rightOther) continue;
      const leftCoords = orientedCoordinates(left, leftOther, nodeId);
      const rightCoords = orientedCoordinates(right, nodeId, rightOther);
      const merged = {
        ...left,
        edge_id: `${left.edge_id}+${right.edge_id}`,
        from_node_id: leftOther,
        to_node_id: rightOther,
        geometry: { type: 'LineString', coordinates: [...leftCoords, ...rightCoords.slice(1)] },
        length_m: Number((left.length_m + right.length_m).toFixed(3)),
        derived_from_raw_feature_ids: [...new Set([...(left.derived_from_raw_feature_ids || []), ...(right.derived_from_raw_feature_ids || [])])]
      };
      const leftIndex = edges.indexOf(left);
      const rightIndex = edges.indexOf(right);
      edges.splice(Math.max(leftIndex, rightIndex), 1);
      edges.splice(Math.min(leftIndex, rightIndex), 1, merged);
      nodeById.delete(nodeId);
      changed = true;
      break;
    }
  }
  const remainingNodes = [...nodeById.values()].map((node) => ({ ...node, degree: edges.reduce((count, edge) => count + (edge.from_node_id === node.node_id || edge.to_node_id === node.node_id ? 1 : 0), 0) }));
  return { ...graph, nodes: remainingNodes, edges };
}

function sameContractionClass(left, right) {
  return left.edge_type === right.edge_type && left.access === right.access && left.routable === right.routable && left.profile_bitmask === right.profile_bitmask;
}

function orientedCoordinates(edge, fromNodeId, toNodeId) {
  const coordinates = edge.geometry.coordinates;
  return edge.from_node_id === fromNodeId && edge.to_node_id === toNodeId ? coordinates : [...coordinates].reverse();
}

function lineParts(geometry) {
  if (geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)) return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) return geometry.coordinates;
  return [];
}

function validCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const coordinate = [Number(value[0]), Number(value[1])];
  return coordinate.every(Number.isFinite) && Math.abs(coordinate[0]) <= 180 && Math.abs(coordinate[1]) <= 90 ? coordinate : null;
}

function sourceFeatureId(feature, dataset, index) {
  for (const field of dataset.source_id_fields || ['GLOBALID', 'GlobalID', 'OBJECTID', 'ObjectID', 'objectid']) {
    const value = feature?.properties?.[field];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  if (feature?.id !== undefined && feature.id !== null) return String(feature.id);
  return `generated-${index}`;
}

function classifyEdge(properties, dataset) {
  if (ALLOWED_EDGE_TYPES.has(properties._mb_edge_type)) return properties._mb_edge_type;
  const configuredDefault = dataset.default_edge_type || dataset.network_kind?.[0] || 'footpath';
  for (const field of dataset.classification_fields || []) {
    const value = String(properties[field] ?? '').trim().toLowerCase();
    const mapped = dataset.classification_map?.[value];
    if (mapped && ALLOWED_EDGE_TYPES.has(mapped)) return mapped;
    if (value.includes('crosswalk') || value === 'crossing') return 'crossing';
    if (value.includes('trail')) return 'trail';
    if (value.includes('footpath') || value === 'path') return 'footpath';
    if (value.includes('sidewalk') || value.includes('privatewalk')) return 'sidewalk';
  }
  return ALLOWED_EDGE_TYPES.has(configuredDefault) ? configuredDefault : 'footpath';
}

function classifyAccess(properties, edgeType, dataset) {
  if (['allowed', 'prohibited', 'unknown'].includes(properties._mb_access)) return properties._mb_access;
  for (const field of dataset.access_fields || []) {
    const value = String(properties[field] ?? '').trim().toLowerCase();
    if (['no', 'private', 'prohibited', 'restricted'].includes(value) || value.includes('private')) return 'prohibited';
    if (['yes', 'public', 'allowed'].includes(value)) return 'allowed';
    if (value) return 'unknown';
  }
  const classificationText = (dataset.classification_fields || []).map((field) => String(properties[field] ?? '').toLowerCase()).join(' ');
  if (classificationText.includes('private')) return 'unknown';
  return dataset.default_access || (edgeType === 'indoor_pathway' ? 'unknown' : 'allowed');
}

function selectAttributes(properties, fields = []) {
  return Object.fromEntries(fields.filter((field) => properties[field] !== undefined).map((field) => [field, properties[field]]));
}

function featureUpdatedAt(properties, fields = ['last_edited_date']) {
  for (const field of fields) {
    const value = properties[field];
    if (value === undefined || value === null || value === '') continue;
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return null;
}

function lineLengthMeters(coordinates) {
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) total += haversineMeters(coordinates[index], coordinates[index + 1]);
  return total;
}

function clusterCoordinates(coordinates, toleranceMeters) {
  if (toleranceMeters === 0) return coordinates.map((coordinate) => [...coordinate]);
  const representatives = [];
  const cells = new Map();
  return coordinates.map((coordinate) => {
    const latScale = 111_320;
    const lonScale = Math.max(1, 111_320 * Math.cos(coordinate[1] * Math.PI / 180));
    const x = coordinate[0] * lonScale;
    const y = coordinate[1] * latScale;
    const cellX = Math.floor(x / toleranceMeters);
    const cellY = Math.floor(y / toleranceMeters);
    let match = null;
    for (let dx = -1; dx <= 1 && !match; dx += 1) {
      for (let dy = -1; dy <= 1 && !match; dy += 1) {
        for (const index of cells.get(`${cellX + dx}:${cellY + dy}`) || []) {
          if (haversineMeters(coordinate, representatives[index]) <= toleranceMeters) {
            match = representatives[index];
            break;
          }
        }
      }
    }
    if (match) return match;
    const index = representatives.push([...coordinate]) - 1;
    const key = `${cellX}:${cellY}`;
    cells.set(key, [...(cells.get(key) || []), index]);
    return representatives[index];
  });
}

function nodeId(datasetId, coordinate) {
  const digest = createHash('sha256').update(`${datasetId}:${coordinate[0].toFixed(7)},${coordinate[1].toFixed(7)}`).digest('hex').slice(0, 16);
  return `${datasetId}:node:${digest}`;
}

function ensureNode(nodes, id, coordinate) {
  if (!nodes.has(id)) nodes.set(id, { node_id: id, lon: coordinate[0], lat: coordinate[1] });
}

function addIncident(index, nodeIdValue, edge) {
  index.set(nodeIdValue, [...(index.get(nodeIdValue) || []), edge]);
}

function nodeType(edges) {
  const types = new Set(edges.map(({ edge_type: type }) => type));
  if (types.has('crossing')) return 'curb_interface';
  if (edges.length > 2) return types.has('trail') ? 'trail_junction' : 'intersection';
  if (types.has('trail')) return 'trail_junction';
  return 'sidewalk_endpoint';
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

export function haversineMeters(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(left[1]);
  const lat2 = radians(right[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(right[0] - left[0]);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
