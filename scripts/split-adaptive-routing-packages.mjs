#!/usr/bin/env node
/** Split the four oversized pilot binary packages into overlapping quadrant shards. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildRuntimeGraph, writeRuntimePackage } from '../motherbird/tools/pedestrian-network/runtime-package.mjs';

const root = process.argv[2] || '.tmp-cache/adaptive-packages';
const outRoot = process.argv[3] || '.tmp-cache/adaptive-subpackages';
const parents = ['z11-584-782', 'z11-584-783', 'z11-585-782', 'z11-585-783'];
const margin = 0.0015;
// Keep each browser-loaded binary graph materially below the previous pilot
// ceiling. Overlap and registry adjacency preserve boundary stitching while
// the lower edge cap limits transient decode/search memory in the worker.
const maxEdges = 20000;
const read = (p) => fs.readFile(p, 'utf8').then(JSON.parse);
const inside = (point, box) => point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
const intersects = (coordinates, box) => coordinates.some((point) => inside(point, box))
  || coordinates.slice(1).some((point, i) => {
    const a = coordinates[i]; const b = point;
    const minX = Math.min(a[0], b[0]); const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]); const maxY = Math.max(a[1], b[1]);
    return maxX >= box[0] && minX <= box[2] && maxY >= box[1] && minY <= box[3];
  });

await fs.rm(outRoot, { recursive: true, force: true });
for (const parent of parents) {
  const graph = await read(path.join(root, parent, 'runtime-graph.json'));
  // Split from the union of the source tile and the occupied graph extent. The
  // graph includes boundary-crossing ways outside the nominal z11 tile, while
  // using only its occupied bbox leaves registry gaps around the tile edges.
  const parentRegistry = await read(path.join('motherbird', 'data', 'fairfax-minio-cells.json'));
  const parentBounds = parentRegistry.cells.find((cell) => cell.id === parent)?.bounds;
  const graphBounds = graph.bounding_box;
  const bounds = parentBounds
    ? [
      Math.min(parentBounds[0], graphBounds[0]),
      Math.min(parentBounds[1], graphBounds[1]),
      Math.max(parentBounds[2], graphBounds[2]),
      Math.max(parentBounds[3], graphBounds[3]),
    ]
    : graphBounds;
  const nodeByIndex = new Map(graph.nodes.map((node, index) => [index, node]));
  const graphEdges = graph.edges.map((edge) => ({
    edge_id: edge[0], from_node_id: nodeByIndex.get(edge[1])[0], to_node_id: nodeByIndex.get(edge[2])[0],
    length_m: edge[3] / 100, edge_type: graph.edge_types[edge[5]] || 'unknown', profile_bitmask: edge[6],
    policy_confidence: edge[7] / 100, source_feature_id: graph.sources?.[edge[8]] || null,
    policy_warning: Boolean(edge[11]), geometry: { type: 'LineString', coordinates: Array.from({ length: edge[10] }, (_, i) => [graph.geometry[(edge[9] + i) * 2] / 1e7, graph.geometry[(edge[9] + i) * 2 + 1] / 1e7]) }
  }));
  const graphNodes = graph.nodes.map((node) => ({ node_id: node[0], lat: node[1] / 1e7, lon: node[2] / 1e7, level: node[3], flags: node[4] }));
  const boxes = [];
  const split = (raw, depth = 0) => {
    const box = [raw[0] - margin, raw[1] - margin, raw[2] + margin, raw[3] + margin];
    const selected = graphEdges.filter((edge) => intersects(edge.geometry.coordinates, box));
    if (selected.length > maxEdges && depth < 6) {
      const midX = (raw[0] + raw[2]) / 2; const midY = (raw[1] + raw[3]) / 2;
      split([raw[0], raw[1], midX, midY], depth + 1); split([midX, raw[1], raw[2], midY], depth + 1);
      split([raw[0], midY, midX, raw[3]], depth + 1); split([midX, midY, raw[2], raw[3]], depth + 1);
    } else if (selected.length) boxes.push({ raw, box, selected });
  };
  split(bounds);
  for (let index = 0; index < boxes.length; index += 1) {
    const { raw, box, selected } = boxes[index];
    const nodeIds = new Set(selected.flatMap((edge) => [edge.from_node_id, edge.to_node_id]));
    const nodes = graphNodes.filter((node) => nodeIds.has(node.node_id));
    const childId = `${parent}-q${index + 1}`;
    const child = { ...graph, dataset_id: `${graph.dataset_id}-q${index + 1}`, nodes, edges: selected };
    const target = path.join(outRoot, childId);
    const runtime = buildRuntimeGraph(child, { id: child.dataset_id, runtime_city: graph.city }, { sourceVersion: graph.source_version, builtAt: graph.built_at });
    const manifest = await writeRuntimePackage(target, runtime);
    await fs.writeFile(path.join(target, 'shard.json'), JSON.stringify({ id: childId, parent, bounds: raw, overlapBounds: box, manifest }, null, 2) + '\n');
    console.log(JSON.stringify({ id: childId, nodes: nodes.length, edges: selected.length, bytes: Object.values(manifest.artifacts).reduce((s, a) => s + a.bytes, 0) }));
  }
}
