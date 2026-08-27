import { haversineMeters } from './graph-builder.mjs';

export function buildQaReport(graph, dataset, { sourceLastEdit = null } = {}) {
  const components = connectedComponents(graph.nodes, graph.edges);
  const duplicates = duplicateGeometryCount(graph.edges);
  const gaps = endpointGapCount(graph.nodes, 2);
  const totalLength = graph.edges.reduce((sum, edge) => sum + edge.length_m, 0);
  const largest = components.length ? Math.max(...components.map(({ edgeCount }) => edgeCount)) : 0;
  const isolated = components.filter(({ edgeCount }) => edgeCount === 1).length;
  const missingSourceIds = graph.raw.features.filter(({ properties }) => String(properties.source_segment_id).startsWith('generated-')).length;
  const sourceIds = graph.raw.features.map(({ properties }) => String(properties.source_segment_id));
  const duplicateSourceIds = sourceIds.length - new Set(sourceIds).size;
  const rejectionReasons = {};
  for (const { reason } of graph.rejected) rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  return {
    city: dataset.jurisdiction,
    dataset: dataset.name,
    registry_id: dataset.id,
    features: graph.raw.features.length,
    rejected_features_or_segments: graph.rejected.length,
    rejection_reasons: rejectionReasons,
    total_length_m: Math.round(totalLength * 1000) / 1000,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    components: components.length,
    largest_component_percent: graph.edges.length ? Math.round((largest / graph.edges.length) * 10_000) / 100 : 0,
    isolated_segments: isolated,
    explicit_crossings: graph.edges.filter(({ edge_type }) => edge_type === 'crossing').length,
    unclassified_pedestrian_links: graph.edges.filter(({ edge_type }) => edge_type === 'pedestrian_link').length,
    crossing_classification_status: dataset.default_edge_type === 'pedestrian_link' ? 'not_present_in_source_schema' : 'source_classified_when_available',
    routable_edges: graph.edges.filter(({ routability }) => routability?.ordinary_walking_beta).length,
    routable_edges_by_profile: {
      research: graph.edges.filter(({ routability }) => routability?.research).length,
      ordinary_walking_beta: graph.edges.filter(({ routability }) => routability?.ordinary_walking_beta).length,
      verified_access: graph.edges.filter(({ routability }) => routability?.verified_access).length,
      accessible_verified: graph.edges.filter(({ routability }) => routability?.accessible_verified).length
    },
    prohibited_edges: graph.edges.filter(({ access }) => access === 'prohibited').length,
    unknown_access_edges: graph.edges.filter(({ access }) => access === 'unknown').length,
    endpoint_gaps_under_2m: gaps,
    duplicate_geometries: duplicates,
    missing_source_ids: missingSourceIds,
    duplicate_source_ids: duplicateSourceIds,
    source_id_stability: dataset.source_id_stability || 'unverified',
    source_last_edit: sourceLastEdit,
    snap_tolerance_m: graph.snap_tolerance_m,
    ingest_status: graph.edges.length && !graph.rejected.length && !missingSourceIds && !duplicateSourceIds ? 'verified_geometry' : 'review_required',
    route_ready: false,
    route_ready_reason: 'Geometry and topology QA do not replace human route-truth validation.'
  };
}

function connectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map(({ node_id }) => [node_id, new Set()]));
  const edgeCounts = new Map(nodes.map(({ node_id }) => [node_id, 0]));
  for (const edge of edges) {
    adjacency.get(edge.from_node_id)?.add(edge.to_node_id);
    adjacency.get(edge.to_node_id)?.add(edge.from_node_id);
    edgeCounts.set(edge.from_node_id, (edgeCounts.get(edge.from_node_id) || 0) + 1);
    edgeCounts.set(edge.to_node_id, (edgeCounts.get(edge.to_node_id) || 0) + 1);
  }
  const seen = new Set();
  const result = [];
  for (const node of nodes) {
    if (seen.has(node.node_id)) continue;
    const queue = [node.node_id];
    seen.add(node.node_id);
    let degreeTotal = 0;
    let nodeCount = 0;
    while (queue.length) {
      const current = queue.pop();
      nodeCount += 1;
      degreeTotal += edgeCounts.get(current) || 0;
      for (const neighbor of adjacency.get(current) || []) {
        if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      }
    }
    result.push({ nodeCount, edgeCount: degreeTotal / 2 });
  }
  return result.filter(({ edgeCount }) => edgeCount > 0);
}

function duplicateGeometryCount(edges) {
  const seen = new Set();
  let duplicates = 0;
  for (const { geometry } of edges) {
    const forward = JSON.stringify(geometry.coordinates);
    const reverse = JSON.stringify([...geometry.coordinates].reverse());
    const key = forward < reverse ? forward : reverse;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function endpointGapCount(nodes, thresholdMeters) {
  const endpoints = nodes.filter(({ degree }) => degree === 1);
  const cellDegrees = thresholdMeters / 111_320;
  const cells = new Map();
  let count = 0;
  for (const endpoint of endpoints) {
    const cellX = Math.floor(endpoint.lon / cellDegrees);
    const cellY = Math.floor(endpoint.lat / cellDegrees);
    const longitudeRadius = Math.max(1, Math.ceil(1 / Math.max(0.1, Math.cos(endpoint.lat * Math.PI / 180))));
    for (let dx = -longitudeRadius; dx <= longitudeRadius; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of cells.get(`${cellX + dx}:${cellY + dy}`) || []) {
          const distance = haversineMeters([endpoint.lon, endpoint.lat], [other.lon, other.lat]);
          if (distance > 0 && distance < thresholdMeters) count += 1;
        }
      }
    }
    const key = `${cellX}:${cellY}`;
    cells.set(key, [...(cells.get(key) || []), endpoint]);
  }
  return count;
}
