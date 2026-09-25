import { activateWalkingCellAt } from './walking-cell-runtime.js';

let worker = null;
let sequence = 0;
const pending = new Map();
let activeWalkingCell = null;

if (typeof window !== 'undefined') window.addEventListener('walking-cell-ready', ({ detail }) => { activeWalkingCell = detail; });

export const ROUTE_FAILURE_MESSAGES = {
  NO_NEARBY_PEDESTRIAN_EDGE: 'A start or destination is too far from the installed pedestrian network.',
  ORIGIN_DISCONNECTED: 'The start is on a disconnected piece of the pedestrian network.',
  DESTINATION_DISCONNECTED: 'The destination is on a disconnected piece of the pedestrian network.',
  NO_ROUTE_IN_COMPONENT: 'Both points are near pedestrian geometry, but no connected route joins them.',
  ROUTING_TIMEOUT: 'Offline routing timed out while loading or searching the cell.',
  ROUTING_WORKER_ERROR: 'The offline routing worker stopped unexpectedly.',
  GRAPH_ARTIFACT_MISMATCH: 'The installed routing artifact failed its integrity check.',
  ACCESS_POLICY_BLOCKED: 'The installed geometry does not meet the selected access policy.',
  ACCESSIBILITY_DATA_INSUFFICIENT: 'Ramp, stair, or grade evidence is insufficient for a verified accessible route.',
  GRAPH_VERSION_UNAVAILABLE: 'An offline pedestrian graph is not installed for this city.',
  INVALID_ROUTE_REQUEST: 'The route request could not be read.'
};

export async function routeOnFoot(points, { city, profile = 'ordinary_walking_beta' } = {}) {
  if (!Array.isArray(points) || points.length < 2) return failure('INVALID_ROUTE_REQUEST');
  const legs = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    try { activeWalkingCell = await activateWalkingCellAt(points[index]); }
    catch (error) { return failure('GRAPH_VERSION_UNAVAILABLE', error.message); }
    if (!activeWalkingCell?.id || activeWalkingCell.availability !== 'routing_available') return failure('GRAPH_VERSION_UNAVAILABLE', activeWalkingCell?.reason);
    const result = await requestRoute({ city, profile, origin: points[index], destination: points[index + 1], avoid: { stairs: false, unverified_edges: false }, cell: activeWalkingCell, cellId: activeWalkingCell?.id, cellRelease: activeWalkingCell?.release });
    if (!result.ok) return result;
    legs.push(result);
  }
  const coordinates = [];
  for (const leg of legs) for (const [lon, lat] of leg.geometry.coordinates) {
    const coordinate = [lat, lon]; const last = coordinates.at(-1);
    if (!last || last[0] !== coordinate[0] || last[1] !== coordinate[1]) coordinates.push(coordinate);
  }
  return {
    ok: true,
    coordinates,
    distanceMeters: legs.reduce((sum, leg) => sum + leg.distance_m, 0),
    durationSeconds: legs.reduce((sum, leg) => sum + leg.estimated_duration_s, 0),
    edgeIds: [...new Set(legs.flatMap((leg) => leg.edge_ids))],
    sourceProvenanceIds: [...new Set(legs.flatMap((leg) => leg.source_provenance_ids))],
    cellId: activeWalkingCell.id,
    cellRelease: activeWalkingCell.release,
    warnings: [...new Set(legs.flatMap((leg) => leg.warnings))],
    instructions: mergeInstructions(legs),
    graphVersion: legs[0].graph_version,
    policyVersion: legs[0].policy_version,
    confidence: { minimum: Math.min(...legs.map((leg) => leg.confidence.minimum)), average: legs.reduce((sum, leg) => sum + leg.confidence.average, 0) / legs.length }
  };
}

function mergeInstructions(legs) {
  const merged = [];
  for (const leg of legs) {
    for (const instruction of leg.instructions || []) {
      if (instruction.type === 'depart' && merged.length) continue;
      merged.push(instruction);
    }
  }
  return merged;
}

function requestRoute(payload) {
  if (typeof Worker === 'undefined') return Promise.resolve(failure('GRAPH_VERSION_UNAVAILABLE'));
  if (!worker) {
    worker = new Worker('./js/offline-router-worker.js?v=20260925-binary-v4', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { window.dispatchEvent(new CustomEvent('routing-progress', { detail: data })); return; }
      if (data.type === 'worker-error') { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(failure('ROUTING_WORKER_ERROR', data.message)); } pending.clear(); return; }
      const callback = pending.get(data.requestId);
      if (!callback) return;
      pending.delete(data.requestId); clearTimeout(callback.timer); callback.resolve(data.result);
    };
    worker.onerror = (event) => {
      const reason = event.message || `${event.filename || 'worker'}:${event.lineno || 0}:${event.colno || 0}`;
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(failure('ROUTING_WORKER_ERROR', reason)); }
      pending.clear(); worker = null;
    };
  }
  const requestId = ++sequence;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(requestId); resolve(failure('ROUTING_TIMEOUT', 'Routing worker exceeded 120 seconds.')); }, 120000);
    pending.set(requestId, { resolve, timer }); worker.postMessage({ type: 'route', requestId, ...payload });
  });
}

function failure(type, reason = null) { return { ok: false, status: type, failure: { type, message: ROUTE_FAILURE_MESSAGES[type] || 'Offline routing failed.', reason } }; }
