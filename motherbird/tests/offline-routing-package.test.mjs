import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPedestrianGraph } from '../tools/pedestrian-network/graph-builder.mjs';
import { buildRuntimeGraph } from '../tools/pedestrian-network/runtime-package.mjs';
import { routeRuntimeGraph } from '../js/runtime-router.mjs';
import { loadOfflineRoutingPackage, OFFLINE_WALK_PACKAGE_FORMAT } from '../js/offline-routing-package.mjs';
import { generateProofArchive } from './fixtures/pmtiles-proof.mjs';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-offline-routing-fixture');

test('offline walk package resolves display PMTiles and a matching runtime that returns a valid route', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-offline-routing-fixture-'));
  const runtimeDir = path.join(output, 'routing-runtime');
  await fs.mkdir(runtimeDir);
  const source = JSON.parse(await fs.readFile(path.join(fixtureDir, 'network.geojson'), 'utf8'));
  const dataset = { id: 'synthetic_offline_routing_fixture', name: 'Synthetic offline routing fixture', jurisdiction: 'Test only', owner: 'Mother Bird tests', default_edge_type: 'trail', default_access: 'yes', preserve_source_segments: true };
  const graph = buildPedestrianGraph(source, dataset, { snapToleranceMeters: 0 });
  const runtime = buildRuntimeGraph(graph, dataset, { builtAt: '2026-09-10T00:00:00.000Z' });
  await fs.writeFile(path.join(runtimeDir, 'runtime-graph.json'), `${JSON.stringify(runtime)}\n`);
  await fs.writeFile(path.join(output, 'walk-network.pmtiles'), generateProofArchive(() => 0).bytes);
  const manifest = { format: OFFLINE_WALK_PACKAGE_FORMAT, package_version: 'synthetic-offline-routing-fixture-v1', source_version: 'synthetic-network-v1', graph_version: runtime.graph_version, artifacts: { walk_network: { path: './walk-network.pmtiles', format: 'pmtiles', source_version: 'synthetic-network-v1' }, routing_runtime: { path: './routing-runtime/runtime-graph.json', format: 'motherbird-runtime-graph-v1', source_version: 'synthetic-network-v1' } } };
  await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const server = http.createServer(async (request, response) => {
    const file = path.join(output, new URL(request.url, 'http://fixture.test').pathname.replace(/^\//, ''));
    try { response.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/vnd.pmtiles' }); response.end(await fs.readFile(file)); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const loaded = await loadOfflineRoutingPackage(new URL(`http://127.0.0.1:${server.address().port}/manifest.json`));
    const networkResponse = await fetch(loaded.networkUrl, { headers: { range: 'bytes=0-7' } });
    assert.equal(Buffer.from(await networkResponse.arrayBuffer()).subarray(0, 7).toString(), 'PMTiles');
    assert.equal(loaded.manifest.artifacts.walk_network.source_version, loaded.manifest.artifacts.routing_runtime.source_version);
    const route = routeRuntimeGraph(loaded.runtime, { profile: 'ordinary_walking_beta', origin: [-77.29995, 38.9], destination: [-77.29905, 38.9] }, { maxSnapMeters: 30 });
    assert.equal(route.status, 'ROUTE_FOUND');
    assert.equal(route.geometry.type, 'LineString');
    assert.ok(route.geometry.coordinates.length >= 2);
    assert.ok(route.distance_m > 0);
    assert.ok(route.edge_ids.some((id) => id.includes('synthetic-trail')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(output, { recursive: true, force: true });
  }
});
