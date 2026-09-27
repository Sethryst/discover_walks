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
  GRAPH_VERSION_UNAVAILABLE: 'We could not calculate that walk right now.',
  INVALID_ROUTE_REQUEST: 'The route request could not be read.'
};

export async function routeOnFoot(points, { city, profile = 'ordinary_walking_beta' } = {}) {
  if (!Array.isArray(points) || points.length < 2) return failure('INVALID_ROUTE_REQUEST');
  const legs = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    let destinationCell = null;
    try {
      activeWalkingCell = await activateWalkingCellAt(points[index]);
      const originCell = activeWalkingCell;
      // Load the destination index as well so a boundary leg can use the
      // neighboring package when the origin package cannot connect it.
      destinationCell = await activateWalkingCellAt(points[index + 1]);
      activeWalkingCell = originCell;
    }
    catch (error) { return failure('GRAPH_VERSION_UNAVAILABLE', error.message); }
    if (!activeWalkingCell?.id || activeWalkingCell.availability !== 'routing_available') return failure('GRAPH_VERSION_UNAVAILABLE', activeWalkingCell?.reason);
    const request = (cell, origin = points[index], destination = points[index + 1]) => requestRoute({ city, profile, origin, destination, maxSnapMeters: 250, avoid: { stairs: false, unverified_edges: false }, cell, cellId: cell?.id, cellRelease: cell?.release });
    let result = await request(activeWalkingCell);
    const neighborIds = new Set(activeWalkingCell.routingNeighbors || []);
    if (result.ok) legs.push(result);
    else if (destinationCell?.id && destinationCell.id !== activeWalkingCell.id
      && neighborIds.has(destinationCell.id) && destinationCell.availability === 'routing_available') {
      const stitched = await stitchBoundaryLeg(points[index], points[index + 1], activeWalkingCell, destinationCell, request);
      if (!stitched) return result;
      legs.push(...stitched);
    } else return result;
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
    cellId: legs.at(-1)?.cell_id || activeWalkingCell.id,
    cellRelease: activeWalkingCell.release,
    warnings: [...new Set(legs.flatMap((leg) => leg.warnings))],
    instructions: mergeInstructions(legs),
    graphVersion: legs[0].graph_version,
    policyVersion: legs[0].policy_version,
    confidence: { minimum: Math.min(...legs.map((leg) => leg.confidence.minimum)), average: legs.reduce((sum, leg) => sum + leg.confidence.average, 0) / legs.length }
  };
}

async function stitchBoundaryLeg(origin, destination, originCell, destinationCell, request) {
  const candidates = boundaryTransferPoints(originCell, destinationCell);
  let best = null;
  for (const transfer of candidates) {
    const first = await request(originCell, origin, transfer);
    if (!first.ok) continue;
    const second = await request(destinationCell, transfer, destination);
    if (!second.ok) continue;
    const firstEnd = first.geometry?.coordinates?.at(-1);
    const secondStart = second.geometry?.coordinates?.[0];
    if (!firstEnd || !secondStart
      || distanceMeters(firstEnd, [transfer.lng, transfer.lat]) > 25
      || distanceMeters(secondStart, [transfer.lng, transfer.lat]) > 25
      || distanceMeters(firstEnd, secondStart) > 25) continue;
    const score = first.distance_m + second.distance_m;
    if (!best || score < best.score) best = { score, legs: [first, second] };
  }
  return best?.legs || null;
}

function distanceMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const lat1 = radians(a[1]); const lat2 = radians(b[1]);
  const dLat = lat2 - lat1; const dLon = radians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function boundaryTransferPoints(left, right) {
  const a = left.bounds; const b = right.bounds;
  const south = Math.max(a.south, b.south); const north = Math.min(a.north, b.north);
  const west = Math.max(a.west, b.west); const east = Math.min(a.east, b.east);
  if (south > north || west > east) return [];
  const points = [];
  if (Math.abs(a.east - b.west) < 1e-7 || Math.abs(b.east - a.west) < 1e-7) {
    const lng = Math.abs(a.east - b.west) < 1e-7 ? a.east : b.east;
    for (let index = 1; index <= 9; index += 1) points.push({ lat: south + (north - south) * index / 10, lng });
  } else if (Math.abs(a.north - b.south) < 1e-7 || Math.abs(b.north - a.south) < 1e-7) {
    const lat = Math.abs(a.north - b.south) < 1e-7 ? a.north : b.north;
    for (let index = 1; index <= 9; index += 1) points.push({ lat, lng: west + (east - west) * index / 10 });
  }
  return points;
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
    worker = new Worker('./js/offline-router-worker.js?v=20260927-cell-stitch-v5', { type: 'module' });
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
    const timer = setTimeout(() => {
      const reason = 'Routing worker exceeded 120 seconds and was cancelled.';
      const cancelled = worker;
      worker = null;
      cancelled?.terminate();
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(failure('ROUTING_TIMEOUT', reason)); }
      pending.clear();
    }, 120000);
    pending.set(requestId, { resolve, timer }); worker.postMessage({ type: 'route', requestId, ...payload });
  });
}

function failure(type, reason = null) { return { ok: false, status: type, failure: { type, message: ROUTE_FAILURE_MESSAGES[type] || 'Offline routing failed.', reason } }; }
