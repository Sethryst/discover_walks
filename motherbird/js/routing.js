import { activateWalkingCellAt, getWalkingCellRegistry } from './walking-cell-runtime.js?v=20261006-routing-hardening-4';

let worker = null;
let sequence = 0;
const pending = new Map();
let activeWalkingCell = null;
let workerReady = false;

if (typeof window !== 'undefined') window.addEventListener('walking-cell-ready', ({ detail }) => { activeWalkingCell = detail; });

export const ROUTE_FAILURE_MESSAGES = {
  NO_NEARBY_PEDESTRIAN_EDGE: 'Choose a point a little closer to a mapped path.',
  ORIGIN_DISCONNECTED: 'Choose a nearby point on a mapped path to start.',
  DESTINATION_DISCONNECTED: 'Choose a nearby point on a mapped path to finish.',
  NO_ROUTE_IN_COMPONENT: 'Try moving one or both points slightly onto a mapped path.',
  ROUTING_TIMEOUT: 'The route is not ready yet. Try again in a moment.',
  ROUTING_SEARCH_LIMIT: 'Try a shorter walk or a smaller map area.',
  ROUTING_GRAPH_UNAVAILABLE: 'The route is not ready yet. Try again in a moment.',
  ROUTING_WORKER_ERROR: 'The route is not ready yet. Try again in a moment.',
  GRAPH_ARTIFACT_MISMATCH: 'The route is not available yet. Try again in a moment.',
  ACCESS_POLICY_BLOCKED: 'That route is not available with the selected walking settings.',
  ACCESSIBILITY_DATA_INSUFFICIENT: 'There is not enough accessibility information to verify that route.',
  GRAPH_VERSION_UNAVAILABLE: 'The route is not ready yet. Try again in a moment.',
  NO_CELL_FOR_COORDINATE: 'Choose points inside the mapped area or move them a little closer together.',
  CROSS_CELL_UNAVAILABLE: 'Try a shorter walk or choose points inside the same mapped area.',
  BOUNDARY_STITCH_FAILED: 'Try a slightly different crossing or choose points a little closer together.',
  INVALID_ROUTE_REQUEST: 'We could not read that route request.'
};

export function routeFailureMessage(result) {
  // Worker messages are diagnostic data, not product copy. Prefer the stable
  // status mapping after a retry so implementation details never leak into normal UI.
  return ROUTE_FAILURE_MESSAGES[result?.status] || 'We could not find a walkable route there. Try moving one or both points slightly onto a mapped path.';
}

/**
 * Additive routing contract. MIP may ask for a profile or an avoid set, but
 * the worker remains the sole producer of route geometry. Unknown optional
 * fields are deliberately carried through so callers can record the exact
 * request without changing legacy behavior.
 */
export async function routeOnFoot(points, {
  city,
  profile = 'ordinary_walking_beta',
  vias = null,
  avoidEdges = [],
  graphVersion = null,
  cellRelease = null
} = {}) {
  const routePoints = Array.isArray(vias) && vias.length >= 2 ? vias : points;
  if (!Array.isArray(routePoints) || routePoints.length < 2) return failure('INVALID_ROUTE_REQUEST');
  const legs = [];
  for (let index = 0; index < routePoints.length - 1; index += 1) {
    let destinationCell = null;
    try {
      activeWalkingCell = await activateWalkingCellAt(routePoints[index], { allowNearestCellLock: true });
      const originCell = activeWalkingCell;
      // Load the destination index as well so a boundary leg can use the
      // neighboring package when the origin package cannot connect it.
      destinationCell = await activateWalkingCellAt(routePoints[index + 1], { allowNearestCellLock: true });
      activeWalkingCell = originCell;
    }
    catch (error) { return failure('GRAPH_VERSION_UNAVAILABLE', error.message); }
    if (!activeWalkingCell?.id) return failure('NO_CELL_FOR_COORDINATE', activeWalkingCell?.reason, activeWalkingCell);
    if (activeWalkingCell.availability !== 'routing_available') return failure('GRAPH_VERSION_UNAVAILABLE', activeWalkingCell?.reason);
    const request = (cell, origin = routePoints[index], destination = routePoints[index + 1]) => requestRouteWithRetry({ city, profile, origin, destination, maxSnapMeters: 3000, maxVisitedNodes: 300000, avoid: { stairs: false, unverified_edges: false }, avoidEdges, graphVersion, cell, cellId: cell?.id, cellRelease: cellRelease || cell?.release });
    let result = await request(activeWalkingCell);
    if (result.ok) legs.push(result);
    else if (destinationCell?.id && destinationCell.id !== activeWalkingCell.id && destinationCell.availability === 'routing_available') {
      let registry;
      try { registry = await getWalkingCellRegistry(); } catch (error) { return failure('GRAPH_VERSION_UNAVAILABLE', error.message); }
      const neighborIds = new Set([...(activeWalkingCell.routingNeighbors || []), ...(destinationCell?.routingNeighbors || [])]);
      // Metadata is a fast hint, not a gate: adaptive releases can omit one
      // side of a shared boundary. Geometry-backed paths are handed to the
      // stitcher, which proves the transfer with real graph searches.
      const cellPath = findCellPath(registry, activeWalkingCell.id, destinationCell.id);
      if (!cellPath) return failure('CROSS_CELL_UNAVAILABLE', `${activeWalkingCell.id} -> ${destinationCell.id}`);
      const stitched = await stitchCellPath(points[index], points[index + 1], cellPath, request);
      if (!stitched) return failure('BOUNDARY_STITCH_FAILED', cellPath.map((cell) => cell.id).join(' -> '));
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

async function requestRouteWithRetry(payload) {
  let result = await requestRoute(payload);
  if (result.ok || !['ROUTING_WORKER_ERROR', 'ROUTING_TIMEOUT', 'GRAPH_VERSION_UNAVAILABLE'].includes(result.status)) return result;
  // A worker can die during a large graph decode or transient cache read. The
  // request layer resets it; one retry makes the next route attempt useful
  // without allowing an infinite loop of expensive graph loads.
  result = await requestRoute(payload);
  if (result.ok || !['ROUTING_WORKER_ERROR', 'ROUTING_TIMEOUT', 'GRAPH_VERSION_UNAVAILABLE'].includes(result.status)) return result;
  return failure('ROUTING_GRAPH_UNAVAILABLE', result.failure?.reason || result.failure?.message);
}

async function stitchCellPath(origin, destination, cells, request, index = 0, current = origin, legs = []) {
  if (index === cells.length - 1) {
    const last = await request(cells[index], current, destination);
    if (!last.ok) return null;
    const start = last.geometry?.coordinates?.[0];
    const tolerance = current?.handoffToleranceMeters || 25;
    if (index > 0 && (!start || distanceMeters(start, [current.lng, current.lat]) > tolerance)) return null;
    return [...legs, last];
  }
  for (const transfer of boundaryTransferPoints(cells[index], cells[index + 1])) {
    const first = await request(cells[index], current, transfer);
    if (!first.ok) continue;
    const firstEnd = first.geometry?.coordinates?.at(-1);
    const tolerance = transfer.handoffToleranceMeters || 25;
    if (!firstEnd || distanceMeters(firstEnd, [transfer.lng, transfer.lat]) > tolerance) continue;
    const stitched = await stitchCellPath(origin, destination, cells, request, index + 1, transfer, [...legs, first]);
    if (stitched) return stitched;
  }
  return null;
}

export function findCellPath(registry, startId, endId) {
  const cells = new Map(registry.cells.map((cell) => [cell.id, cell]));
  const queue = [startId]; const previous = new Map([[startId, null]]);
  while (queue.length) {
    const id = queue.shift(); if (id === endId) break;
    const cell = cells.get(id); if (!cell) continue;
    const neighbors = new Set([...(cell.routingNeighbors || [])]);
    // Adaptive cells can overlap or meet at a boundary without both sides
    // carrying neighbor metadata. Treat geometry as a candidate edge; the
    // stitcher still has to prove that both graphs route to the handoff.
    for (const candidate of registry.cells) {
      if (candidate.id !== id && boundaryTransferPoints(cell, candidate).length) neighbors.add(candidate.id);
    }
    for (const neighbor of neighbors) if (cells.has(neighbor) && !previous.has(neighbor)) { previous.set(neighbor, id); queue.push(neighbor); }
  }
  if (!previous.has(endId)) return null;
  const path = []; for (let id = endId; id; id = previous.get(id)) path.unshift(cells.get(id)); return path;
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
  if (Math.abs(south - north) < 1e-7 && Math.abs(west - east) < 1e-7) {
    // Some buffered graph packages meet at a logical corner while the actual
    // shared pedestrian node sits inside the buffered overlap. Let both
    // workers snap to that junction instead of probing only the empty corner.
    // Probe the small buffered overlap as well. The exact logical corner can
    // be off-network even when both cell graphs share a nearby pedestrian
    // node (especially when source tiles were clipped independently).
    for (const [latOffset, lngOffset] of [[-0.0002, 0.0014], [-0.0004, 0.0014], [0, 0.0014], [-0.0002, 0.0007], [-0.0002, 0.002]]) {
      points.push({ lat: south + latOffset, lng: west + lngOffset, handoffToleranceMeters: 250 });
    }
    points.push({ lat: south, lng: west, handoffToleranceMeters: 250 });
  } else if (Math.abs(a.east - b.west) < 1e-7 || Math.abs(b.east - a.west) < 1e-7) {
    const lng = Math.abs(a.east - b.west) < 1e-7 ? a.east : b.east;
    for (let index = 1; index <= 9; index += 1) points.push({ lat: south + (north - south) * index / 10, lng });
  } else if (Math.abs(a.north - b.south) < 1e-7 || Math.abs(b.north - a.south) < 1e-7) {
    const lat = Math.abs(a.north - b.south) < 1e-7 ? a.north : b.north;
    for (let index = 1; index <= 9; index += 1) points.push({ lat, lng: west + (east - west) * index / 10 });
  } else if (west <= east && south <= north) {
    // Adaptive-resolution cells often overlap rather than share an exact
    // edge. Offer a small deterministic set of interior handoffs.
    for (let row = 1; row <= 3; row += 1) for (let column = 1; column <= 3; column += 1) {
      points.push({ lat: south + (north - south) * row / 4, lng: west + (east - west) * column / 4 });
    }
  }
  return points;
}

function mergeInstructions(legs) {
  const merged = [];
  legs.forEach((leg, legIndex) => {
    for (const instruction of leg.instructions || []) {
      if (instruction.type === 'depart' && merged.length) continue;
      if (instruction.type === 'arrive' && legIndex < legs.length - 1) continue;
      merged.push(instruction);
    }
  });
  return merged;
}

function requestRoute(payload) {
  if (typeof Worker === 'undefined') return Promise.resolve(failure('GRAPH_VERSION_UNAVAILABLE'));
  if (!worker) {
    worker = new Worker('./js/offline-router-worker.js?v=20261011-routing-candidates-1', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { window.dispatchEvent(new CustomEvent('routing-progress', { detail: data })); return; }
      if (data.type === 'worker-ready') { workerReady = true; window.dispatchEvent(new CustomEvent('routing-worker-ready', { detail: data })); return; }
      if (data.type === 'worker-error') { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(failure('ROUTING_WORKER_ERROR', `${data.message} [phase=${data.phase || 'unknown'}]`)); } pending.clear(); return; }
      const callback = pending.get(data.requestId);
      if (!callback) return;
      pending.delete(data.requestId); clearTimeout(callback.timer); callback.resolve(data.result);
    };
    worker.onerror = (event) => {
      const reason = event.message || event.error?.message || event.error?.stack || `${event.filename || 'worker'}:${event.lineno || 0}:${event.colno || 0} [ready=${workerReady}]`;
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(failure('ROUTING_WORKER_ERROR', reason)); }
      pending.clear(); worker = null; workerReady = false;
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

function failure(type, reason = null) { const result = { ok: false, status: type, failure: { type, message: ROUTE_FAILURE_MESSAGES[type] || 'Offline routing failed.', reason } }; console.error('routing-failure', JSON.stringify(result)); return result; }
