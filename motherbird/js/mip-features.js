/** Pure MIP feature and composition primitives.
 *
 * These functions sit between verified router output and ambient ranking. They
 * never create geometry and they fail closed when an evidence sidecar does not
 * belong to the route's graph artifact.
 */

export const MIP_SIDECAR_SCHEMA = 1;

export function validateEdgeFeatureSidecar(sidecar, expected = {}) {
  if (!sidecar || sidecar.schemaVersion !== MIP_SIDECAR_SCHEMA) return { valid: false, reason: 'SCHEMA_UNSUPPORTED' };
  if (expected.graphVersion && sidecar.graphVersion !== expected.graphVersion) return { valid: false, reason: 'GRAPH_VERSION_MISMATCH' };
  if (expected.cellId && sidecar.cellId !== expected.cellId) return { valid: false, reason: 'CELL_ID_MISMATCH' };
  if (expected.routingRelease && sidecar.routingRelease !== expected.routingRelease) return { valid: false, reason: 'RELEASE_MISMATCH' };
  if (sidecar.checksumValid === false || (expected.checksum && sidecar.checksum !== expected.checksum) || (sidecar.checksum && stableChecksum(stripChecksum(sidecar)) !== sidecar.checksum)) return { valid: false, reason: 'CHECKSUM_INVALID' };
  return { valid: true };
}

export function aggregateRouteFeatures(route, sidecar, poiRecords = [], corridorCatalogue = [], expected = {}) {
  const expectedGraph = expected.graphVersion || route?.graphVersion || route?.graph_version;
  const expectedCell = expected.cellId || route?.cellId || route?.cell_id;
  const expectedRelease = expected.routingRelease || route?.cellRelease || route?.release;
  const validation = validateEdgeFeatureSidecar(sidecar, { graphVersion: expectedGraph, cellId: expectedCell, routingRelease: expectedRelease });
  const warnings = [...(route?.warnings || [])];
  if (!validation.valid) {
    if (sidecar) warnings.push(`MIP sidecar ignored: ${validation.reason}.`);
    return emptyFeatures(warnings);
  }
  const edgeIds = [...new Set((route?.edgeIds || route?.edge_ids || []).map(String))];
  const records = new Map((sidecar.edges || sidecar.edgeFeatures || []).map((edge) => [String(edge.edgeId || edge.id), edge]));
  const catalog = new Map((corridorCatalogue || []).filter((corridor) => corridor?.status === 'verified').map((corridor) => [String(corridor.id), corridor]));
  const corridorIds = new Set();
  const corridorLengths = new Map();
  const signalTotals = { nature: 0, history: 0, culture: 0, quiet: 0, greenway: 0, waterAdjacent: 0, majorRoadExposure: 0, stairs: 0, surfaceKnown: 0 };
  const provenance = new Set();
  let minimumConfidence = 1;
  let confidenceWeight = 0;
  let confidenceLength = 0;
  for (const edgeId of edgeIds) {
    const edge = records.get(edgeId);
    if (!edge || edge.freshness === 'stale' || edge.accessUncertainty === true) continue;
    const confidence = clamp(Number(edge.confidence ?? 0), 0, 1);
    const length = Math.max(0, Number(edge.lengthMeters || 0));
    minimumConfidence = Math.min(minimumConfidence, confidence);
    confidenceLength += length;
    confidenceWeight += length * confidence;
    for (const sourceId of edge.sourceIds || []) provenance.add(String(sourceId));
    for (const corridorRef of edge.corridorRefs || []) {
      const corridorId = String(corridorRef.id || corridorRef);
      const corridor = catalog.get(corridorId);
      if (!corridor) continue;
      corridorIds.add(corridorId);
      corridorLengths.set(corridorId, Math.max(corridorLengths.get(corridorId) || 0, length));
      for (const signal of corridor.signals || corridorRef.signals || []) signalTotals[signal] = Math.max(signalTotals[signal] || 0, length);
      for (const sourceId of corridor.sourceIds || []) provenance.add(String(sourceId));
    }
    for (const signal of Object.keys(signalTotals)) {
      const value = Number(edge.signals?.[signal] || 0);
      signalTotals[signal] = signal === 'majorRoadExposure' || signal === 'stairs' ? signalTotals[signal] + value : Math.max(signalTotals[signal], value);
    }
  }
  const pois = (poiRecords || []).filter((poi) => route?.stops?.some((stop) => String(stop.id || stop.name) === String(poi.id || poi.name)) && isTrustedPoi(poi));
  const poiCounts = { total: pois.length, history: 0, culture: 0, nature: 0 };
  pois.forEach((poi) => { for (const tag of poi.tags || [poi.category]) if (tag in poiCounts) poiCounts[tag] += 1; });
  return {
    valid: true,
    edgeCount: edgeIds.length,
    corridorIds: [...corridorIds].sort(),
    corridorLengths: Object.fromEntries([...corridorLengths.entries()].sort()),
    signalTotals,
    poiCounts,
    sourceProvenanceIds: [...provenance].sort(),
    confidence: { minimum: edgeIds.length ? minimumConfidence : 0, lengthWeighted: confidenceLength ? confidenceWeight / confidenceLength : 0 },
    warnings,
    facts: { corridorIds: [...corridorIds].sort(), corridorCount: corridorIds.size, poiCount: poiCounts.total, extraMinutes: Number(route?.directDurationMinutes ? Math.max(0, Number(route.durationSeconds || 0) / 60 - route.directDurationMinutes) : 0) }
  };
}

export function scoreMIPRoute(route, features, profile = 'ordinary', constraints = {}) {
  const durationSeconds = Number(route?.durationSeconds ?? route?.estimated_duration_s ?? Infinity);
  const maxMinutes = Number(constraints.maxMinutes ?? Infinity);
  if (!route?.ok || durationSeconds > maxMinutes * 60) return { feasible: false, reason: 'DURATION_LIMIT' };
  if (features?.valid === false) return { feasible: false, reason: 'FEATURES_INVALID' };
  if (profile === 'accessible_verified' && ((features?.signalTotals?.stairs || 0) > 0 || route?.accessibilityVerified === false)) return { feasible: false, reason: 'ACCESSIBILITY_CONSTRAINT' };
  const f = features?.signalTotals || {};
  const p = profile === 'discovery' || profile === 'nature' ? (f.nature + f.greenway + f.waterAdjacent) : profile === 'history' || profile === 'culture' ? (f.history + f.culture) : profile === 'quiet' ? (f.quiet + f.greenway - f.majorRoadExposure) : 0;
  const score = p - Number(constraints.extraMinutesWeight || 0.25) * Math.max(0, durationSeconds / 60 - Number(route.directDurationMinutes || 0));
  return { feasible: true, quantizedScore: Math.round(score * 1000), score, profile };
}

export function composeVerifiedLegs(legs, { vias = [] } = {}) {
  const validLegs = (legs || []).filter((leg) => leg?.ok && Array.isArray(leg.geometry?.coordinates || leg.coordinates));
  if (!validLegs.length || validLegs.length !== (vias.length ? vias.length + 1 : validLegs.length)) return { ok: false, status: 'INVALID_COMPOSITION' };
  const coordinates = [];
  const edgeIds = [];
  for (const leg of validLegs) {
    const geometry = leg.geometry?.coordinates || leg.coordinates;
    for (const point of geometry) if (!coordinates.length || !samePoint(coordinates.at(-1), point)) coordinates.push(point);
    edgeIds.push(...(leg.edgeIds || leg.edge_ids || []).map(String));
  }
  const uniqueEdges = [...new Set(edgeIds)];
  return { ok: true, coordinates, edgeIds, uniqueEdgeIds: uniqueEdges, hasUTurn: detectUTurn(edgeIds), joinedAtVias: true, distanceMeters: validLegs.reduce((sum, leg) => sum + Number(leg.distanceMeters ?? leg.distance_m ?? 0), 0), durationSeconds: validLegs.reduce((sum, leg) => sum + Number(leg.durationSeconds ?? leg.estimated_duration_s ?? 0), 0), graphVersion: validLegs[0].graphVersion || validLegs[0].graph_version, cellRelease: validLegs[0].cellRelease || validLegs[0].release };
}

export function detectUTurn(edgeIds) {
  const ids = (edgeIds || []).map(String);
  return ids.some((id, index) => ids.indexOf(id) !== index && index - ids.indexOf(id) <= 2);
}

function emptyFeatures(warnings) { return { valid: false, edgeCount: 0, corridorIds: [], corridorLengths: {}, signalTotals: {}, poiCounts: { total: 0 }, sourceProvenanceIds: [], confidence: { minimum: 0, lengthWeighted: 0 }, warnings, facts: { corridorIds: [], corridorCount: 0, poiCount: 0, extraMinutes: 0 } }; }
function samePoint(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function stripChecksum(value) { const { checksum: _checksum, ...withoutChecksum } = value || {}; return withoutChecksum; }
function stableChecksum(value) { let hash = 2166136261; for (const character of JSON.stringify(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`; }
function isTrustedPoi(poi) { return poi?.review?.validationStatus === 'valid' || poi?.unverified === false || sourceUrl(poi?.source) || sourceUrl(poi?.provenance) || typeof poi?.sourceUrl === 'string'; }
function sourceUrl(source) { return Array.isArray(source) ? source.some((item) => sourceUrl(item)) : typeof source === 'string' ? /^https?:\/\//i.test(source) : Boolean(source?.url && /^https?:\/\//i.test(source.url)); }
