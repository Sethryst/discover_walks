import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { POLICY_VERSION } from './access-policy.mjs';

const gzipAsync = promisify(gzip);
const EDGE_TYPES = ['unknown', 'sidewalk', 'footpath', 'crossing', 'trail', 'pedestrian_plaza', 'indoor_pathway', 'pedestrian_link'];
const GRID_SIZE_E7 = 20_000; // ~220 m north/south; exact distance is checked at query time.

export function buildRuntimeGraph(graph, dataset, { builtAt = new Date().toISOString() } = {}) {
  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.node_id, index]));
  const nodes = graph.nodes.map((node) => [node.node_id, Math.round(node.lat * 1e7), Math.round(node.lon * 1e7), Number(node.level || 0), Number(node.flags || 0)]);
  const sources = [];
  const sourceIndex = new Map();
  const geometry = [];
  const edges = graph.edges.map((edge) => {
    if (!sourceIndex.has(edge.source_feature_id)) {
      sourceIndex.set(edge.source_feature_id, sources.length);
      sources.push(edge.source_feature_id);
    }
    const geometryOffset = geometry.length / 2;
    for (const [lon, lat] of edge.geometry.coordinates) geometry.push(Math.round(lon * 1e7), Math.round(lat * 1e7));
    return [
      edge.edge_id,
      nodeIndex.get(edge.from_node_id),
      nodeIndex.get(edge.to_node_id),
      Math.round(edge.length_m * 100),
      Math.round(edge.length_m * 100),
      Math.max(0, EDGE_TYPES.indexOf(edge.edge_type)),
      edge.profile_bitmask || 0,
      Math.round((edge.policy_confidence ?? 0.5) * 100),
      sourceIndex.get(edge.source_feature_id),
      geometryOffset,
      edge.geometry.coordinates.length,
      edge.policy_warning ? 1 : 0
    ];
  });
  const spatialIndex = buildSpatialIndex(edges, geometry);
  const bounds = graphBounds(nodes);
  const graphHasher = createHash('sha256');
  for (const value of [dataset.id, POLICY_VERSION, nodes, edges, geometry, sources]) graphHasher.update(JSON.stringify(value));
  const graphHash = graphHasher.digest('hex');
  return {
    schema_version: 1,
    dataset_id: dataset.id,
    city: dataset.runtime_city || inferCity(dataset),
    graph_version: `${dataset.id}-${graphHash.slice(0, 12)}`,
    graph_hash: graphHash,
    policy_version: POLICY_VERSION,
    built_at: builtAt,
    bounding_box: bounds,
    edge_types: EDGE_TYPES,
    nodes,
    edges,
    geometry,
    sources,
    spatial_index: spatialIndex
  };
}

export async function writeRuntimePackage(outputDir, runtime, auditEdges = []) {
  await fs.mkdir(outputDir, { recursive: true });
  const files = {
    'nodes.bin': encodeNodes(runtime.nodes),
    'edges.bin': encodeEdges(runtime.edges),
    'adjacency.bin': encodeAdjacency(runtime.nodes.length, runtime.edges),
    'edge_geometry.bin': encodeGeometry(runtime.geometry, runtime.edges),
    'edge_spatial_index.bin': encodeSpatialIndex(runtime.spatial_index),
    'runtime-graph.json': Buffer.from(`${JSON.stringify(runtime)}\n`)
  };
  const attributes = auditEdges.map((edge, index) => JSON.stringify({
    edge_index: index,
    edge_id: edge.edge_id,
    source_dataset_id: edge.source_dataset_id,
    source_feature_id: edge.source_feature_id,
    raw_access: edge.raw_access,
    access_evidence: edge.access_evidence,
    routability: edge.routability,
    policy_warning: edge.policy_warning,
    source_attributes: edge.source_attributes || null
  })).join('\n');
  files['edge_attributes.jsonl.gz'] = await gzipAsync(Buffer.from(attributes ? `${attributes}\n` : ''));

  for (const [name, contents] of Object.entries(files)) await atomicWrite(path.join(outputDir, name), contents);
  const manifest = {
    schema_version: 1,
    city: runtime.city,
    dataset_id: runtime.dataset_id,
    graph_version: runtime.graph_version,
    source_versions: [runtime.dataset_id],
    policy_version: runtime.policy_version,
    graph_hash: runtime.graph_hash,
    built_at: runtime.built_at,
    bounding_box: runtime.bounding_box,
    node_count: runtime.nodes.length,
    edge_count: runtime.edges.length,
    artifacts: Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, { bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }]))
  };
  await atomicWrite(path.join(outputDir, 'manifest.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return manifest;
}

function buildSpatialIndex(edges, geometry) {
  const buckets = {};
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    const offset = edge[9] * 2;
    const length = edge[10] * 2;
    let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;
    for (let index = offset; index < offset + length; index += 2) {
      minLon = Math.min(minLon, geometry[index]); maxLon = Math.max(maxLon, geometry[index]);
      minLat = Math.min(minLat, geometry[index + 1]); maxLat = Math.max(maxLat, geometry[index + 1]);
    }
    for (let x = Math.floor(minLon / GRID_SIZE_E7); x <= Math.floor(maxLon / GRID_SIZE_E7); x += 1) {
      for (let y = Math.floor(minLat / GRID_SIZE_E7); y <= Math.floor(maxLat / GRID_SIZE_E7); y += 1) {
        const key = `${x}:${y}`;
        (buckets[key] ||= []).push(edgeIndex);
      }
    }
  }
  return { type: 'fixed_grid_edge_bbox', cell_size_e7: GRID_SIZE_E7, buckets };
}

function encodeNodes(nodes) {
  const buffer = Buffer.alloc(8 + nodes.length * 12);
  buffer.write('MBN1', 0); buffer.writeUInt32LE(nodes.length, 4);
  nodes.forEach((node, index) => {
    const offset = 8 + index * 12;
    buffer.writeInt32LE(node[1], offset); buffer.writeInt32LE(node[2], offset + 4);
    buffer.writeInt16LE(node[3], offset + 8); buffer.writeUInt16LE(node[4], offset + 10);
  });
  return buffer;
}

function encodeEdges(edges) {
  const stride = 40;
  const buffer = Buffer.alloc(8 + edges.length * stride);
  buffer.write('MBE1', 0); buffer.writeUInt32LE(edges.length, 4);
  edges.forEach((edge, index) => {
    const offset = 8 + index * stride;
    buffer.writeUInt32LE(edge[1], offset); buffer.writeUInt32LE(edge[2], offset + 4);
    buffer.writeUInt32LE(edge[3], offset + 8); buffer.writeUInt32LE(edge[4], offset + 12);
    buffer.writeUInt8(edge[5], offset + 16); buffer.writeUInt8(edge[6], offset + 17);
    buffer.writeUInt8(edge[7], offset + 18); buffer.writeUInt8(edge[11], offset + 19);
    buffer.writeUInt32LE(edge[8], offset + 20); buffer.writeUInt32LE(edge[9], offset + 24);
    buffer.writeUInt32LE(edge[10], offset + 28); buffer.writeUInt32LE(index, offset + 32);
  });
  return buffer;
}

function encodeAdjacency(nodeCount, edges) {
  const lists = Array.from({ length: nodeCount }, () => []);
  edges.forEach((edge, edgeIndex) => {
    lists[edge[1]].push([edgeIndex, edge[2]]);
    lists[edge[2]].push([edgeIndex, edge[1]]);
  });
  const entryCount = lists.reduce((sum, list) => sum + list.length, 0);
  const buffer = Buffer.alloc(12 + (nodeCount + 1) * 4 + entryCount * 8);
  buffer.write('MBA1', 0); buffer.writeUInt32LE(nodeCount, 4); buffer.writeUInt32LE(entryCount, 8);
  let cursor = 0;
  lists.forEach((list, index) => { buffer.writeUInt32LE(cursor, 12 + index * 4); cursor += list.length; });
  buffer.writeUInt32LE(cursor, 12 + nodeCount * 4);
  let offset = 12 + (nodeCount + 1) * 4;
  for (const list of lists) for (const [edgeIndex, nodeIndex] of list) {
    buffer.writeUInt32LE(edgeIndex, offset); buffer.writeUInt32LE(nodeIndex, offset + 4); offset += 8;
  }
  return buffer;
}

function encodeGeometry(values, edges) {
  const encoded = [...values];
  for (const edge of edges) {
    const start = edge[9] * 2; const end = (edge[9] + edge[10]) * 2;
    for (let index = end - 2; index >= start + 2; index -= 2) {
      encoded[index] -= encoded[index - 2]; encoded[index + 1] -= encoded[index - 1];
    }
  }
  const buffer = Buffer.alloc(8 + encoded.length * 4);
  buffer.write('MBG1', 0); buffer.writeUInt32LE(encoded.length, 4);
  encoded.forEach((value, index) => buffer.writeInt32LE(value, 8 + index * 4));
  return buffer;
}

function encodeSpatialIndex(index) {
  const entries = Object.entries(index.buckets);
  const referenceCount = entries.reduce((sum, [, edgeIndexes]) => sum + edgeIndexes.length, 0);
  const buffer = Buffer.alloc(16 + entries.length * 16 + referenceCount * 4);
  buffer.write('MBS1', 0); buffer.writeUInt32LE(index.cell_size_e7, 4);
  buffer.writeUInt32LE(entries.length, 8); buffer.writeUInt32LE(referenceCount, 12);
  let referenceOffset = 0;
  entries.forEach(([key, edgeIndexes], entryIndex) => {
    const [x, y] = key.split(':').map(Number); const offset = 16 + entryIndex * 16;
    buffer.writeInt32LE(x, offset); buffer.writeInt32LE(y, offset + 4);
    buffer.writeUInt32LE(referenceOffset, offset + 8); buffer.writeUInt32LE(edgeIndexes.length, offset + 12);
    referenceOffset += edgeIndexes.length;
  });
  let outputOffset = 16 + entries.length * 16;
  for (const [, edgeIndexes] of entries) for (const edgeIndex of edgeIndexes) { buffer.writeUInt32LE(edgeIndex, outputOffset); outputOffset += 4; }
  return buffer;
}

function graphBounds(nodes) {
  if (!nodes.length) return null;
  return nodes.reduce((bounds, node) => [
    Math.min(bounds[0], node[2] / 1e7), Math.min(bounds[1], node[1] / 1e7),
    Math.max(bounds[2], node[2] / 1e7), Math.max(bounds[3], node[1] / 1e7)
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

function inferCity(dataset) {
  if (/new york/i.test(dataset.jurisdiction)) return 'newyork';
  if (/philadelphia|delaware valley/i.test(dataset.jurisdiction)) return 'philadelphia';
  return dataset.id;
}

async function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, filePath);
}
