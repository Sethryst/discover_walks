let worker = null;
let sequence = 0;
const pending = new Map();

export const ROUTE_FAILURE_MESSAGES = {
  NO_NEARBY_PEDESTRIAN_EDGE: 'A start or destination is too far from the installed pedestrian network.',
  ORIGIN_DISCONNECTED: 'The start is on a disconnected piece of the pedestrian network.',
  DESTINATION_DISCONNECTED: 'The destination is on a disconnected piece of the pedestrian network.',
  NO_ROUTE_IN_COMPONENT: 'Both points are near pedestrian geometry, but no connected route joins them.',
  ACCESS_POLICY_BLOCKED: 'The installed geometry does not meet the selected access policy.',
  ACCESSIBILITY_DATA_INSUFFICIENT: 'Ramp, stair, or grade evidence is insufficient for a verified accessible route.',
  GRAPH_VERSION_UNAVAILABLE: 'An offline pedestrian graph is not installed for this city.',
  INVALID_ROUTE_REQUEST: 'The route request could not be read.'
};

export async function routeOnFoot(points, { city, profile = 'ordinary_walking_beta' } = {}) {
  if (!Array.isArray(points) || points.length < 2) return failure('INVALID_ROUTE_REQUEST');
  const legs = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const result = await requestRoute({ city, profile, origin: points[index], destination: points[index + 1], avoid: { stairs: false, unverified_edges: false } });
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
    warnings: [...new Set(legs.flatMap((leg) => leg.warnings))],
    graphVersion: legs[0].graph_version,
    policyVersion: legs[0].policy_version,
    confidence: { minimum: Math.min(...legs.map((leg) => leg.confidence.minimum)), average: legs.reduce((sum, leg) => sum + leg.confidence.average, 0) / legs.length }
  };
}

function requestRoute(payload) {
  if (typeof Worker === 'undefined') return Promise.resolve(failure('GRAPH_VERSION_UNAVAILABLE'));
  if (!worker) {
    worker = new Worker('./js/offline-router-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      const callback = pending.get(data.requestId);
      if (!callback) return;
      pending.delete(data.requestId); callback(data.result);
    };
    worker.onerror = () => {
      for (const callback of pending.values()) callback(failure('GRAPH_VERSION_UNAVAILABLE'));
      pending.clear(); worker = null;
    };
  }
  const requestId = ++sequence;
  return new Promise((resolve) => { pending.set(requestId, resolve); worker.postMessage({ type: 'route', requestId, ...payload }); });
}

function failure(type) { return { ok: false, status: type, failure: { type, message: ROUTE_FAILURE_MESSAGES[type] } }; }
