/**
 * Build-time corridor evidence matcher.
 *
 * This module never creates routing geometry. It only relates source lines to
 * already compiled graph edges and emits deterministic evidence for a sidecar
 * builder. Flowlines intentionally use a separate, weaker adjacency matcher.
 */

export const PILOT_BBOX = Object.freeze([-77.54, 38.60, -76.91, 39.06]);

const EARTH_RADIUS_M = 6371000;

export function matchOfficialCorridor(source, graphEdges, {
  bbox = PILOT_BBOX,
  matchMeters = 15,
  fallbackMeters = 25,
  sampleMeters = 10,
  retrievedAt = null
} = {}) {
  const coordinates = clipLine(source?.geometry?.coordinates || source?.coordinates || [], bbox);
  const samples = densifyLine(coordinates, sampleMeters);
  const edges = normalizeEdges(graphEdges).filter((edge) => edge.geometry.length > 1 && lineIntersectsBbox(edge.geometry, bbox));
  const strict = assignSamples(samples, edges, matchMeters);
  const matched = strict.matchedCount ? strict : assignSamples(samples, edges, fallbackMeters);
  const threshold = strict.matchedCount ? matchMeters : fallbackMeters;
  const matchedEdgeIds = stableUnique(matched.assignments.map((assignment) => assignment.edge.id));
  const matchedLength = matchedEdgeIds.reduce((total, id) => total + (edges.find((edge) => edge.id === id)?.lengthMeters || 0), 0);
  const coverage = samples.length ? matched.matchedCount / samples.length : 0;
  const gaps = unbridgedGaps(samples, matched.assignments, threshold);
  const quality = {
    sampleCount: samples.length,
    matchedSampleCount: matched.matchedCount,
    matchedEdgeIds,
    matchedLengthMeters: round(matchedLength),
    coverageFraction: round(coverage, 4),
    medianOffsetMeters: round(median(matched.offsets)),
    maxOffsetMeters: round(Math.max(0, ...matched.offsets)),
    bearingDifferenceDegrees: round(median(matched.bearings)),
    unbridgedGapsMeters: gaps.map(round),
    thresholdMeters: threshold,
    continuity: continuity(matchedEdgeIds, edges),
    confidence: confidence({ coverage, offsets: matched.offsets, gaps, continuity: continuity(matchedEdgeIds, edges) })
  };
  const status = quality.confidence >= 0.8 && coverage >= 0.8 && quality.medianOffsetMeters <= 10 && !gaps.some((gap) => gap > 150)
    ? 'verified'
    : coverage >= 0.4 && quality.continuity
      ? 'candidate'
      : 'rejected';
  return {
    id: String(source?.id || source?.properties?.id || source?.properties?.name || 'unnamed-corridor'),
    name: String(source?.name || source?.properties?.name || 'Unnamed corridor'),
    kind: 'official-trail',
    status,
    sourceIds: source?.sourceIds || (source?.sourceId ? [String(source.sourceId)] : []),
    sourceUrl: source?.sourceUrl || source?.source?.url || null,
    retrievedAt,
    geometry: { type: 'LineString', coordinates },
    quality
  };
}

export function matchFlowlineAdjacency(flowline, graphEdges, {
  bbox = PILOT_BBOX,
  minMeters = 30,
  maxMeters = 75,
  sampleMeters = 10,
  retrievedAt = null
} = {}) {
  const coordinates = clipLine(flowline?.geometry?.coordinates || flowline?.coordinates || [], bbox);
  const samples = densifyLine(coordinates, sampleMeters);
  const edges = normalizeEdges(graphEdges).filter((edge) => edge.geometry.length > 1 && lineIntersectsBbox(edge.geometry, bbox));
  const assignments = samples.map((sample) => {
    const candidates = edges.map((edge) => ({ edge, ...nearestPointOnLine(sample, edge.geometry) }))
      .filter((candidate) => candidate.distanceMeters >= minMeters && candidate.distanceMeters <= maxMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.edge.id.localeCompare(b.edge.id));
    return candidates[0] || null;
  });
  const matched = assignments.filter(Boolean);
  const edgeIds = stableUnique(matched.map((item) => item.edge.id));
  const coverage = samples.length ? matched.length / samples.length : 0;
  return {
    id: String(flowline?.id || flowline?.properties?.id || flowline?.properties?.name || 'unnamed-flowline'),
    name: String(flowline?.name || flowline?.properties?.name || 'Unnamed flowline'),
    kind: 'flowline-adjacency',
    status: coverage >= 0.4 ? 'candidate' : 'rejected',
    label: coverage >= 0.4 ? 'creek-adjacent' : 'rejected',
    sourceIds: flowline?.sourceIds || (flowline?.sourceId ? [String(flowline.sourceId)] : []),
    sourceUrl: flowline?.sourceUrl || flowline?.source?.url || null,
    retrievedAt,
    geometry: { type: 'LineString', coordinates },
    quality: {
      sampleCount: samples.length,
      matchedSampleCount: matched.length,
      matchedEdgeIds: edgeIds,
      coverageFraction: round(coverage, 4),
      medianOffsetMeters: round(median(matched.map((item) => item.distanceMeters))),
      maxOffsetMeters: round(Math.max(0, ...matched.map((item) => item.distanceMeters))),
      note: 'Flowline adjacency is not trail alignment and cannot be labelled waterfront trail.'
    }
  };
}

export function buildCorridorReport(corridors, { graphVersion, cellId, routingRelease, bbox = PILOT_BBOX, builtAt = '1970-01-01T00:00:00.000Z' } = {}) {
  const sorted = [...corridors].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    schemaVersion: 1,
    graphVersion: graphVersion || null,
    cellId: cellId || null,
    routingRelease: routingRelease || null,
    bbox: [...bbox],
    builtAt,
    corridors: sorted,
    summary: {
      total: sorted.length,
      verified: sorted.filter((corridor) => corridor.status === 'verified').length,
      candidate: sorted.filter((corridor) => corridor.status === 'candidate').length,
      rejected: sorted.filter((corridor) => corridor.status === 'rejected').length
    }
  };
}

function normalizeEdges(edges) {
  return (Array.isArray(edges) ? edges : []).map((edge, index) => {
    const geometry = edge.geometry?.coordinates || edge.coordinates || [];
    return {
      ...edge,
      id: String(edge.id || edge.edgeId || `edge-${index + 1}`),
      geometry,
      lengthMeters: Number(edge.lengthMeters) || lineLength(geometry),
      from: edge.from ?? edge.fromNode ?? null,
      to: edge.to ?? edge.toNode ?? null
    };
  });
}

function assignSamples(samples, edges, maxMeters) {
  const assignments = []; const offsets = []; const bearings = [];
  for (const sample of samples) {
    const best = edges.map((edge) => ({ edge, ...nearestPointOnLine(sample, edge.geometry) }))
      .filter((item) => item.distanceMeters <= maxMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.edge.id.localeCompare(b.edge.id))[0];
    if (!best) { assignments.push(null); continue; }
    assignments.push(best); offsets.push(best.distanceMeters); bearings.push(best.bearingDifferenceDegrees);
  }
  return { assignments, offsets, bearings, matchedCount: offsets.length };
}

function continuity(ids, edges) {
  if (ids.length < 2) return true;
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  for (let index = 1; index < ids.length; index += 1) {
    const previous = byId.get(ids[index - 1]); const current = byId.get(ids[index]);
    if (!previous || !current) return false;
    if (previous.id === current.id) continue;
    const joins = [previous.to, previous.from].filter((node) => node !== null && node !== undefined);
    const currentNodes = [current.to, current.from].filter((node) => node !== null && node !== undefined);
    if (joins.length && currentNodes.length && !joins.some((node) => currentNodes.includes(node))) return false;
  }
  return true;
}

function unbridgedGaps(samples, assignments, maxMeters) {
  const gaps = []; let last = null;
  assignments.forEach((assignment, index) => {
    if (assignment) { last = index; return; }
    if (last === null) return;
    const next = assignments.slice(index + 1).findIndex(Boolean);
    if (next < 0) return;
    const nextIndex = index + 1 + next;
    if (nextIndex > index + 1) gaps.push(lineLength(samples.slice(index, nextIndex + 1)));
  });
  return gaps;
}

function confidence({ coverage, offsets, gaps, continuity: isContinuous }) {
  if (!coverage || !isContinuous) return 0;
  const offsetScore = Math.max(0, 1 - (median(offsets) / 25));
  const gapScore = gaps.length ? Math.max(0, 1 - Math.max(...gaps) / 150) : 1;
  return round(coverage * offsetScore * gapScore, 4);
}

function clipLine(coordinates, bbox) {
  return coordinates.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]);
}

function lineIntersectsBbox(coordinates, bbox) { return coordinates.some(([lng, lat]) => lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]); }

function densifyLine(coordinates, spacingMeters) {
  const output = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index]; const to = coordinates[index + 1]; const distance = distanceMeters(from, to); const steps = Math.max(1, Math.ceil(distance / spacingMeters));
    for (let step = index ? 1 : 0; step < steps; step += 1) output.push(interpolate(from, to, step / steps));
  }
  if (coordinates.length) output.push(coordinates.at(-1));
  return output;
}

function nearestPointOnLine(point, coordinates) {
  let best = { distanceMeters: Infinity, bearingDifferenceDegrees: 180 };
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index]; const to = coordinates[index + 1]; const projected = project(point, from, to);
    const edgeBearing = bearing(from, to); const pointBearing = bearing(projected.coordinate, point);
    const delta = Math.abs(((edgeBearing - pointBearing + 540) % 360) - 180);
    if (projected.distanceMeters < best.distanceMeters) best = { ...projected, bearingDifferenceDegrees: delta };
  }
  return best;
}

function project(point, from, to) {
  const scale = Math.cos(point[1] * Math.PI / 180); const ax = (from[0] - point[0]) * scale; const ay = from[1] - point[1]; const bx = (to[0] - point[0]) * scale; const by = to[1] - point[1]; const dx = bx - ax; const dy = by - ay; const denominator = dx * dx + dy * dy; const t = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0; const coordinate = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  return { coordinate, distanceMeters: distanceMeters(point, coordinate) };
}

function lineLength(coordinates) { let total = 0; for (let index = 1; index < coordinates.length; index += 1) total += distanceMeters(coordinates[index - 1], coordinates[index]); return total; }
function distanceMeters(a, b) { const lat1 = a[1] * Math.PI / 180; const lat2 = b[1] * Math.PI / 180; const dLat = lat2 - lat1; const dLon = (b[0] - a[0]) * Math.PI / 180; const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2; return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }
function bearing(from, to) { const radians = (value) => value * Math.PI / 180; const y = Math.sin(radians(to[0] - from[0])) * Math.cos(radians(to[1])); const x = Math.cos(radians(from[1])) * Math.sin(radians(to[1])) - Math.sin(radians(from[1])) * Math.cos(radians(to[1])) * Math.cos(radians(to[0] - from[0])); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
function interpolate(from, to, fraction) { return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction]; }
function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function stableUnique(values) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function round(value, digits = 1) { const factor = 10 ** digits; return Math.round((Number(value) || 0) * factor) / factor; }
