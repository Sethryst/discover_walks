import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPedestrianGraph } from '../tools/pedestrian-network/graph-builder.mjs';
import { buildRuntimeGraph, writeRuntimePackage } from '../tools/pedestrian-network/runtime-package.mjs';
import { routeRuntimeGraph } from '../js/runtime-router.mjs';
import { createRouteServer } from '../tools/pedestrian-network/route-api.mjs';

const dataset = {
  id: 'runtime_fixture', name: 'Runtime Fixture', jurisdiction: 'New York City, New York', owner: 'Test Municipal GIS',
  default_edge_type: 'sidewalk', default_access: 'unknown', preserve_source_segments: true
};

function source(features = baseFeatures()) { return { type: 'FeatureCollection', features }; }
function line(id, coordinates, properties = {}) { return { type: 'Feature', id, properties, geometry: { type: 'LineString', coordinates } }; }
function baseFeatures() {
  return [
    line('a', [[-74, 40.7], [-73.999, 40.7]]),
    line('b', [[-73.999, 40.7], [-73.998, 40.7]]),
    line('island', [[-73.9, 40.8], [-73.899, 40.8]])
  ];
}

test('ordinary walking materializes unknown pedestrian geometry without enabling verified profiles', () => {
  const graph = buildPedestrianGraph(source(), dataset, { snapToleranceMeters: 0 });
  assert.equal(graph.edges[0].raw_access, 'unknown');
  assert.equal(graph.edges[0].access_evidence, 'municipal_pedestrian_network');
  assert.equal(graph.edges[0].routability.ordinary_walking_beta, true);
  assert.equal(graph.edges[0].routability.verified_access, false);
  assert.equal(graph.edges[0].policy_confidence, 0.8);
  assert.match(graph.edges[0].policy_warning, /not independently verified/);
});

test('runtime graph routes from nearest edges and returns provenance, confidence, and typed failures', () => {
  const graph = buildPedestrianGraph(source(), dataset, { snapToleranceMeters: 0 });
  const runtime = buildRuntimeGraph(graph, dataset, { builtAt: '2026-08-27T00:00:00.000Z' });
  const route = routeRuntimeGraph(runtime, { profile: 'ordinary_walking_beta', origin: { lat: 40.7, lon: -73.9999 }, destination: { lat: 40.7, lon: -73.9981 } }, { maxSnapMeters: 30 });
  assert.equal(route.status, 'ROUTE_FOUND');
  assert.ok(route.distance_m > 100);
  assert.deepEqual(route.source_provenance_ids, ['a', 'b']);
  assert.equal(route.confidence.minimum, 0.8);
  assert.equal(route.warnings.length, 1);
  assert.equal(routeRuntimeGraph(runtime, { profile: 'verified_access', origin: [-73.9999, 40.7], destination: [-73.9981, 40.7] }, { maxSnapMeters: 30 }).status, 'ACCESS_POLICY_BLOCKED');
  assert.equal(routeRuntimeGraph(runtime, { profile: 'ordinary_walking_beta', origin: [-74, 40.7], destination: [-73.9, 40.8] }, { maxSnapMeters: 30 }).status, 'NO_ROUTE_IN_COMPONENT');
  assert.equal(routeRuntimeGraph(runtime, { profile: 'ordinary_walking_beta', origin: [-75, 41], destination: [-73.9981, 40.7] }, { maxSnapMeters: 30 }).status, 'NO_NEARBY_PEDESTRIAN_EDGE');
});

test('runtime package writes compact graph, adjacency, geometry, index, attributes, and manifest artifacts', async () => {
  const graph = buildPedestrianGraph(source(), dataset, { snapToleranceMeters: 0 });
  const runtime = buildRuntimeGraph(graph, dataset, { builtAt: '2026-08-27T00:00:00.000Z' });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mother-bird-runtime-'));
  const manifest = await writeRuntimePackage(directory, runtime, graph.edges);
  const names = (await fs.readdir(directory)).sort();
  assert.deepEqual(names, ['adjacency.bin', 'edge_attributes.jsonl.gz', 'edge_geometry.bin', 'edge_spatial_index.bin', 'edges.bin', 'manifest.json', 'nodes.bin', 'runtime-graph.json']);
  assert.equal(manifest.policy_version, '2026-08-27.1');
  assert.equal(manifest.node_count, graph.nodes.length);
  assert.equal(manifest.edge_count, graph.edges.length);
  assert.ok(Object.values(manifest.artifacts).every(({ bytes, sha256 }) => bytes > 0 && sha256.length === 64));
});

test('local POST /route serves the same typed runtime contract', async () => {
  const graph = buildPedestrianGraph(source(), dataset, { snapToleranceMeters: 0 });
  const runtime = buildRuntimeGraph(graph, dataset, { builtAt: '2026-08-27T00:00:00.000Z' });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mother-bird-api-'));
  const graphPath = path.join(directory, 'runtime-graph.json');
  await fs.writeFile(graphPath, JSON.stringify(runtime));
  const server = await createRouteServer({ graphs: { newyork: graphPath }, port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city: 'newyork', profile: 'ordinary_walking_beta', origin: [-74, 40.7], destination: [-73.998, 40.7] })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.status, 'ROUTE_FOUND');
    assert.equal(result.graph_version, runtime.graph_version);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
