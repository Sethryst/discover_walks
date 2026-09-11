import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildRegionPedestrianNetwork, PACKAGE_FORMAT, PRODUCER_VERSION } from '../tools/pedestrian-network/producer.mjs';
import { readPmtilesHeader, readPmtilesMetadata } from '../tools/pedestrian-network/pmtiles-writer.mjs';
import { loadOfflineRoutingPackage } from '../js/offline-routing-package.mjs';
import { routeRuntimeGraph } from '../js/runtime-router.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'regional-pedestrian-producer');

test('regional producer writes matching display/runtime artifacts that load and route', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'motherbird-regional-walk-'));
  const output = path.join(temporary, 'package');
  const secondOutput = path.join(temporary, 'package-second');
  try {
    const result = await buildRegionPedestrianNetwork({
      config: path.join(fixture, 'config.json'),
      osmGeojson: path.join(fixture, 'osm.geojson'),
      output
    });
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, PACKAGE_FORMAT);
    assert.equal(manifest.producer_version, PRODUCER_VERSION);
    assert.equal(manifest.source_version, result.manifest.source_version);
    assert.equal(manifest.artifacts.walk_network.source_version, manifest.source_version);
    assert.equal(manifest.artifacts.routing_runtime.source_version, manifest.source_version);
    assert.ok(manifest.checksums['walk-network.pmtiles'].startsWith('sha256:'));
    assert.ok(manifest.counts.edges >= 4);
    assert.equal(manifest.counts.barriers_and_crossing_nodes, 1);
    const provenance = JSON.parse(await fs.readFile(path.join(output, 'provenance.json'), 'utf8'));
    assert.equal(provenance.merge.overlaps_suppressed.length, 1);
    assert.equal(provenance.merge.access_conflicts_cautiously_blocked.length, 1);

    const pmtiles = await fs.readFile(path.resolve(output, manifest.artifacts.walk_network.path));
    const header = readPmtilesHeader(pmtiles);
    const metadata = readPmtilesMetadata(pmtiles);
    assert.equal(header.spec_version, 3);
    assert.equal(header.tile_type, 1);
    assert.ok(header.addressed_tiles > 0);
    assert.equal(metadata.source_version, manifest.source_version);
    assert.equal(metadata.producer_version, PRODUCER_VERSION);
    assert.deepEqual(metadata.vector_layers.map(({ id }) => id), ['walk_network', 'barriers']);
    const pmtilesApi = await loadVendoredPmtiles();
    const archive = new pmtilesApi.PMTiles({
      getKey: () => 'generated-walk-network',
      getBytes: async (offset, length) => ({ data: pmtiles.buffer.slice(pmtiles.byteOffset + offset, pmtiles.byteOffset + offset + length) })
    });
    assert.equal((await archive.getHeader()).tileType, 1);
    assert.equal((await archive.getMetadata()).source_version, manifest.source_version);
    const tileCoordinate = zxyFor(-77.2995, 38.9, header.min_zoom);
    const vectorTile = await archive.getZxy(header.min_zoom, tileCoordinate.x, tileCoordinate.y);
    assert.ok(vectorTile?.data?.byteLength > 0);

    const runtimePath = path.resolve(output, manifest.artifacts.routing_runtime.path);
    const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
    assert.equal(runtime.graph_version, manifest.graph_version);
    assert.equal(runtime.source_version, manifest.source_version);

    const repeated = await buildRegionPedestrianNetwork({
      config: path.join(fixture, 'config.json'),
      osmGeojson: path.join(fixture, 'osm.geojson'),
      output: secondOutput
    });
    assert.equal(repeated.manifest.source_version, manifest.source_version);
    assert.equal(repeated.manifest.graph_version, manifest.graph_version);
    assert.deepEqual(repeated.manifest.checksums, manifest.checksums);
    assert.deepEqual(await fs.readFile(path.join(secondOutput, 'walk-network.pmtiles')), pmtiles);

    const server = createStaticServer(output);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const manifestUrl = new URL(`http://127.0.0.1:${server.address().port}/manifest.json`);
      const loaded = await loadOfflineRoutingPackage(manifestUrl);
      const route = routeRuntimeGraph(loaded.runtime, {
        profile: 'ordinary_walking_beta',
        origin: [-77.29998, 38.9],
        destination: [-77.29852, 38.9]
      }, { maxSnapMeters: 20 });
      assert.equal(route.status, 'ROUTE_FOUND');
      assert.equal(route.geometry.type, 'LineString');
      assert.ok(route.geometry.coordinates.length >= 5);
      assert.ok(route.edge_ids.length >= 4);
      assert.ok(route.edge_ids.some((id) => id.includes('official-sidewalk-a')));
      assert.ok(route.edge_ids.some((id) => id.includes('osm:way/12')));
      assert.ok(route.distance_m > 100);
      assert.equal(route.graph_version, manifest.graph_version);
      assert.ok(route.source_provenance_ids.includes('fairfax_fixture_sidewalks:official-sidewalk-a'));
      assert.ok(route.source_provenance_ids.includes('osm:way/11'));

      await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify({ ...manifest, graph_version: 'mismatched-graph-version' })}\n`);
      await assert.rejects(() => loadOfflineRoutingPackage(manifestUrl), /version does not match/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('regional producer fails clearly when required OSM tags yield no network', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'motherbird-regional-walk-empty-'));
  const empty = path.join(temporary, 'empty.geojson');
  await fs.writeFile(empty, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'node/1', properties: { amenity: 'bench' }, geometry: { type: 'Point', coordinates: [-77.299, 38.9] } }] }));
  try {
    await assert.rejects(() => buildRegionPedestrianNetwork({
      config: path.join(fixture, 'config.json'), osmGeojson: empty, output: path.join(temporary, 'package')
    }), /no walkable features with required/);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

async function loadVendoredPmtiles() {
  const source = await fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'pmtiles.js'), 'utf8');
  const context = { TextDecoder, TextEncoder, Response, DecompressionStream, Headers, AbortController, Blob, console };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__pmtiles = pmtiles;`, context);
  return context.__pmtiles;
}

function zxyFor(lon, lat, z) {
  const n = 2 ** z;
  return {
    x: Math.floor((lon + 180) / 360 * n),
    y: Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)
  };
}

function createStaticServer(root) {
  return http.createServer(async (request, response) => {
    const relative = new URL(request.url, 'http://fixture.test').pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root) + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const bytes = await fs.readFile(file);
      response.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/vnd.pmtiles', 'content-length': bytes.length });
      response.end(bytes);
    } catch {
      response.writeHead(404); response.end();
    }
  });
}
