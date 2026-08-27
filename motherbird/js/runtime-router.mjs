const PROFILE_BITS = {
  research: 1 << 0,
  ordinary_walking_beta: 1 << 1,
  verified_access: 1 << 2,
  accessible_verified: 1 << 3
};
const WALKING_METERS_PER_SECOND = 1.35;

export function routeRuntimeGraph(runtime, request, { maxSnapMeters = 150 } = {}) {
  const profile = request.profile || 'ordinary_walking_beta';
  const profileBit = PROFILE_BITS[profile];
  if (!profileBit) return failure('ACCESS_POLICY_BLOCKED', runtime, { profile });
  if (!runtime?.nodes?.length || !runtime?.edges?.length || !runtime.spatial_index) {
    return failure('GRAPH_VERSION_UNAVAILABLE', runtime, { profile });
  }
  const origin = point(request.origin);
  const destination = point(request.destination);
  const originAny = nearestEdge(runtime, origin, null, maxSnapMeters);
  const destinationAny = nearestEdge(runtime, destination, null, maxSnapMeters);
  if (!originAny || !destinationAny) {
    return failure('NO_NEARBY_PEDESTRIAN_EDGE', runtime, {
      profile,
      origin_snap_m: originAny?.distance_m ?? null,
      destination_snap_m: destinationAny?.distance_m ?? null
    });
  }
  const start = nearestEdge(runtime, origin, profileBit, maxSnapMeters);
  const end = nearestEdge(runtime, destination, profileBit, maxSnapMeters);
  if (!start || !end) {
    const accessibilityBlocked = profile === 'accessible_verified'
      && nearestEdge(runtime, start ? destination : origin, PROFILE_BITS.ordinary_walking_beta, maxSnapMeters);
    return failure(accessibilityBlocked ? 'ACCESSIBILITY_DATA_INSUFFICIENT' : 'ACCESS_POLICY_BLOCKED', runtime, {
      profile,
      blocked_endpoint: !start ? 'origin' : 'destination'
    });
  }
  if (start.edge_index === end.edge_index) return sameEdgeRoute(runtime, start, end, profile);

  const adjacency = buildAdjacency(runtime, profileBit);
  const distance = new Map();
  const previous = new Map();
  const queue = new MinHeap();
  for (const seed of endpointCosts(runtime, start)) {
    distance.set(seed.node_index, seed.cost_m);
    previous.set(seed.node_index, { start_seed: seed });
    queue.push({ node_index: seed.node_index, cost_m: seed.cost_m });
  }
  const goals = new Map(endpointCosts(runtime, end).map((goal) => [goal.node_index, goal]));
  let bestGoal = null;
  while (queue.size) {
    const current = queue.pop();
    if (current.cost_m !== distance.get(current.node_index)) continue;
    const goal = goals.get(current.node_index);
    if (goal && (!bestGoal || current.cost_m + goal.cost_m < bestGoal.cost_m)) bestGoal = { ...goal, cost_m: current.cost_m + goal.cost_m };
    if (bestGoal && current.cost_m >= bestGoal.cost_m) break;
    for (const step of adjacency[current.node_index] || []) {
      const candidate = current.cost_m + runtime.edges[step.edge_index][4] / 100;
      if (candidate >= (distance.get(step.node_index) ?? Infinity)) continue;
      distance.set(step.node_index, candidate);
      previous.set(step.node_index, { node_index: current.node_index, edge_index: step.edge_index });
      queue.push({ node_index: step.node_index, cost_m: candidate });
    }
  }
  if (!bestGoal) return failure('NO_ROUTE_IN_COMPONENT', runtime, {
    profile, origin_edge_id: runtime.edges[start.edge_index][0], destination_edge_id: runtime.edges[end.edge_index][0]
  });

  const steps = [];
  let cursor = bestGoal.node_index;
  while (previous.get(cursor)?.edge_index !== undefined) {
    const step = previous.get(cursor);
    steps.push({ from: step.node_index, to: cursor, edge_index: step.edge_index });
    cursor = step.node_index;
  }
  steps.reverse();
  const startSeed = previous.get(cursor).start_seed;
  const coordinates = partialToEndpoint(runtime, start, startSeed.node_index);
  for (const step of steps) appendCoordinates(coordinates, orientedEdgeCoordinates(runtime, step.edge_index, step.from));
  appendCoordinates(coordinates, partialFromEndpoint(runtime, end, bestGoal.node_index));
  const edgeIndexes = unique([start.edge_index, ...steps.map((step) => step.edge_index), end.edge_index]);
  return routeResponse(runtime, profile, coordinates, edgeIndexes, bestGoal.cost_m, start, end);
}

function sameEdgeRoute(runtime, start, end, profile) {
  const coordinates = betweenSnaps(edgeCoordinates(runtime, start.edge_index), start, end);
  const distance = Math.abs(start.fraction - end.fraction) * runtime.edges[start.edge_index][3] / 100;
  return routeResponse(runtime, profile, coordinates, [start.edge_index], distance, start, end);
}

function routeResponse(runtime, profile, coordinates, edgeIndexes, distanceMeters, start, end) {
  const confidences = edgeIndexes.map((index) => runtime.edges[index][7] / 100);
  const warnings = unique(edgeIndexes.filter((index) => runtime.edges[index][11]).map(() => 'Includes pedestrian geometry whose public access is inferred, not independently verified.'));
  return {
    ok: true,
    status: 'ROUTE_FOUND',
    profile,
    geometry: { type: 'LineString', coordinates },
    edge_ids: edgeIndexes.map((index) => runtime.edges[index][0]),
    edge_types: edgeIndexes.map((index) => runtime.edge_types[runtime.edges[index][5]] || 'unknown'),
    crossing_edge_ids: edgeIndexes.filter((index) => runtime.edge_types[runtime.edges[index][5]] === 'crossing').map((index) => runtime.edges[index][0]),
    source_provenance_ids: unique(edgeIndexes.map((index) => runtime.sources[runtime.edges[index][8]])),
    distance_m: round(distanceMeters),
    estimated_duration_s: Math.round(distanceMeters / WALKING_METERS_PER_SECOND),
    confidence: {
      minimum: Math.min(...confidences),
      average: round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    },
    warnings,
    graph_version: runtime.graph_version,
    graph_hash: runtime.graph_hash,
    policy_version: runtime.policy_version,
    snaps: { origin_m: round(start.distance_m), destination_m: round(end.distance_m) }
  };
}

function nearestEdge(runtime, coordinate, profileBit, maxSnapMeters) {
  const lonE7 = Math.round(coordinate[0] * 1e7); const latE7 = Math.round(coordinate[1] * 1e7);
  const size = runtime.spatial_index.cell_size_e7;
  const cellX = Math.floor(lonE7 / size); const cellY = Math.floor(latE7 / size);
  const cellMeters = Math.max(40, size / 1e7 * 111_320 * Math.cos(coordinate[1] * Math.PI / 180));
  const rings = Math.max(1, Math.ceil(maxSnapMeters / cellMeters) + 1);
  const candidates = new Set();
  for (let dx = -rings; dx <= rings; dx += 1) for (let dy = -rings; dy <= rings; dy += 1) {
    for (const edgeIndex of runtime.spatial_index.buckets[`${cellX + dx}:${cellY + dy}`] || []) candidates.add(edgeIndex);
  }
  let best = null;
  for (const edgeIndex of candidates) {
    const edge = runtime.edges[edgeIndex];
    if (profileBit !== null && !(edge[6] & profileBit)) continue;
    const projected = projectOnLine(coordinate, edgeCoordinates(runtime, edgeIndex));
    if ((!best || projected.distance_m < best.distance_m) && projected.distance_m <= maxSnapMeters) best = { ...projected, edge_index: edgeIndex };
  }
  return best;
}

function projectOnLine(pointValue, coordinates) {
  let best = null; let walked = 0; const total = lineLength(coordinates);
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index]; const to = coordinates[index + 1];
    const scale = Math.cos(pointValue[1] * Math.PI / 180);
    const ax = (from[0] - pointValue[0]) * scale; const ay = from[1] - pointValue[1];
    const bx = (to[0] - pointValue[0]) * scale; const by = to[1] - pointValue[1];
    const dx = bx - ax; const dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const snapped = [pointValue[0] + (ax + dx * t) / scale, pointValue[1] + ay + dy * t];
    const distance = haversine(pointValue, snapped);
    const segmentLength = haversine(from, to);
    if (!best || distance < best.distance_m) best = { coordinate: snapped, distance_m: distance, segment_index: index, segment_t: t, fraction: total ? (walked + segmentLength * t) / total : 0 };
    walked += segmentLength;
  }
  return best;
}

function endpointCosts(runtime, snap) {
  const edge = runtime.edges[snap.edge_index]; const length = edge[3] / 100;
  return [{ node_index: edge[1], cost_m: length * snap.fraction }, { node_index: edge[2], cost_m: length * (1 - snap.fraction) }];
}

function buildAdjacency(runtime, bit) {
  const adjacency = Array.from({ length: runtime.nodes.length }, () => []);
  runtime.edges.forEach((edge, edgeIndex) => {
    if (!(edge[6] & bit)) return;
    adjacency[edge[1]].push({ node_index: edge[2], edge_index: edgeIndex });
    adjacency[edge[2]].push({ node_index: edge[1], edge_index: edgeIndex });
  });
  return adjacency;
}

function edgeCoordinates(runtime, edgeIndex) {
  const edge = runtime.edges[edgeIndex]; const result = [];
  for (let index = edge[9] * 2; index < (edge[9] + edge[10]) * 2; index += 2) result.push([runtime.geometry[index] / 1e7, runtime.geometry[index + 1] / 1e7]);
  return result;
}

function orientedEdgeCoordinates(runtime, edgeIndex, fromNode) {
  const edge = runtime.edges[edgeIndex]; const coordinates = edgeCoordinates(runtime, edgeIndex);
  return edge[1] === fromNode ? coordinates : coordinates.reverse();
}

function partialToEndpoint(runtime, snap, nodeIndex) {
  const edge = runtime.edges[snap.edge_index]; const coords = edgeCoordinates(runtime, snap.edge_index);
  return nodeIndex === edge[1]
    ? [snap.coordinate, ...coords.slice(0, snap.segment_index + 1).reverse()]
    : [snap.coordinate, ...coords.slice(snap.segment_index + 1)];
}

function partialFromEndpoint(runtime, snap, nodeIndex) {
  return partialToEndpoint(runtime, snap, nodeIndex).reverse();
}

function betweenSnaps(coordinates, start, end) {
  if (start.fraction <= end.fraction) return [start.coordinate, ...coordinates.slice(start.segment_index + 1, end.segment_index + 1), end.coordinate];
  return [end.coordinate, ...coordinates.slice(end.segment_index + 1, start.segment_index + 1), start.coordinate].reverse();
}

function appendCoordinates(target, addition) {
  for (const coordinate of addition) {
    const last = target.at(-1);
    if (!last || last[0] !== coordinate[0] || last[1] !== coordinate[1]) target.push(coordinate);
  }
}

function failure(type, runtime, detail = {}) {
  return { ok: false, status: type, failure: { type, ...detail }, graph_version: runtime?.graph_version || null, policy_version: runtime?.policy_version || null };
}

function point(value) {
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]), Number(value[1])];
  return [Number(value?.lon ?? value?.lng), Number(value?.lat)];
}

function lineLength(coordinates) { return coordinates.slice(1).reduce((sum, coordinate, index) => sum + haversine(coordinates[index], coordinate), 0); }
function haversine(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(left[1]); const lat2 = radians(right[1]);
  const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(radians(right[0] - left[0]) / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.sqrt(a));
}
function unique(values) { return [...new Set(values)]; }
function round(value) { return Math.round(value * 1000) / 1000; }

class MinHeap {
  constructor() { this.values = []; }
  get size() { return this.values.length; }
  push(value) {
    this.values.push(value); let index = this.values.length - 1;
    while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.values[parent].cost_m <= value.cost_m) break; this.values[index] = this.values[parent]; index = parent; }
    this.values[index] = value;
  }
  pop() {
    const root = this.values[0]; const tail = this.values.pop();
    if (this.values.length && tail) {
      let index = 0;
      while (true) { const left = index * 2 + 1; const right = left + 1; if (left >= this.values.length) break; const child = right < this.values.length && this.values[right].cost_m < this.values[left].cost_m ? right : left; if (this.values[child].cost_m >= tail.cost_m) break; this.values[index] = this.values[child]; index = child; }
      this.values[index] = tail;
    }
    return root;
  }
}
