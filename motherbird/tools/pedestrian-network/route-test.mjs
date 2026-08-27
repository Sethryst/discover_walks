import { haversineMeters } from './graph-builder.mjs';

export function routeBetween(graph, origin, destination, { includeUnknownAccess = false, maxSnapMeters = 150 } = {}) {
  const start = nearestNode(graph.nodes, origin);
  const end = nearestNode(graph.nodes, destination);
  if (!start || !end || start.distance_m > maxSnapMeters || end.distance_m > maxSnapMeters) {
    return { status: 'NO_NEARBY_PATH', start_snap_m: start?.distance_m ?? null, end_snap_m: end?.distance_m ?? null };
  }
  const adjacency = buildAdjacency(graph.edges, includeUnknownAccess);
  const distance = new Map([[start.node.node_id, 0]]);
  const previous = new Map();
  const queue = new MinHeap();
  queue.push({ nodeId: start.node.node_id, cost: 0 });
  while (queue.size) {
    const current = queue.pop();
    if (current.cost !== distance.get(current.nodeId)) continue;
    if (current.nodeId === end.node.node_id) break;
    for (const step of adjacency.get(current.nodeId) || []) {
      const candidate = current.cost + step.edge.length_m;
      if (candidate >= (distance.get(step.nodeId) ?? Infinity)) continue;
      distance.set(step.nodeId, candidate);
      previous.set(step.nodeId, { nodeId: current.nodeId, edge: step.edge });
      queue.push({ nodeId: step.nodeId, cost: candidate });
    }
  }
  if (!distance.has(end.node.node_id)) {
    return { status: 'NO_ROUTE', start_node_id: start.node.node_id, end_node_id: end.node.node_id, start_snap_m: start.distance_m, end_snap_m: end.distance_m };
  }
  const steps = [];
  let cursor = end.node.node_id;
  while (cursor !== start.node.node_id) {
    const step = previous.get(cursor);
    steps.push({ from: step.nodeId, to: cursor, edge: step.edge });
    cursor = step.nodeId;
  }
  steps.reverse();
  return {
    status: 'ROUTE',
    start_node_id: start.node.node_id,
    end_node_id: end.node.node_id,
    start_snap_m: round(start.distance_m),
    end_snap_m: round(end.distance_m),
    distance_m: round(distance.get(end.node.node_id)),
    edge_count: steps.length,
    source_feature_ids: steps.map(({ edge }) => edge.source_feature_id),
    coordinates: joinCoordinates(steps)
  };
}

export function runRouteTests(graph, tests, options = {}) {
  const results = tests.map((definition) => {
    const result = routeBetween(graph, definition.origin, definition.destination, {
      ...options,
      maxSnapMeters: definition.max_snap_m ?? options.maxSnapMeters
    });
    return { ...definition, actual_status: result.status, passed: result.status === definition.expected_status, result };
  });
  return {
    schema_version: 1,
    validation_level: 'topology_smoke_test',
    human_route_truth_complete: false,
    accessibility_routing_supported: false,
    crossing_classification_supported: false,
    unknown_access_override: Boolean(options.includeUnknownAccess),
    tests: results,
    summary: { total: results.length, passed: results.filter(({ passed }) => passed).length, failed: results.filter(({ passed }) => !passed).length }
  };
}

function nearestNode(nodes, coordinate) {
  let best = null;
  for (const node of nodes) {
    const distance = haversineMeters(coordinate, [node.lon, node.lat]);
    if (!best || distance < best.distance_m) best = { node, distance_m: distance };
  }
  return best;
}

function buildAdjacency(edges, includeUnknownAccess) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (edge.access === 'prohibited' || (edge.access === 'unknown' && !includeUnknownAccess)) continue;
    addStep(adjacency, edge.from_node_id, edge.to_node_id, edge);
    addStep(adjacency, edge.to_node_id, edge.from_node_id, edge);
  }
  return adjacency;
}

function addStep(adjacency, from, to, edge) {
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push({ nodeId: to, edge });
}

function joinCoordinates(steps) {
  const joined = [];
  for (const step of steps) {
    const coordinates = step.edge.from_node_id === step.from ? step.edge.geometry.coordinates : [...step.edge.geometry.coordinates].reverse();
    joined.push(...(joined.length ? coordinates.slice(1) : coordinates));
  }
  return joined;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

class MinHeap {
  constructor() { this.values = []; }
  get size() { return this.values.length; }
  push(value) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].cost <= value.cost) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop() {
    const root = this.values[0];
    const tail = this.values.pop();
    if (this.values.length && tail) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.values.length) break;
        const child = right < this.values.length && this.values[right].cost < this.values[left].cost ? right : left;
        if (this.values[child].cost >= tail.cost) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = tail;
    }
    return root;
  }
}
