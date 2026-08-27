import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPedestrianGraph } from '../tools/pedestrian-network/graph-builder.mjs';
import { buildQaReport } from '../tools/pedestrian-network/qa.mjs';
import { run } from '../tools/pedestrian-network/cli.mjs';
import { fetchGeoJsonDataset } from '../tools/pedestrian-network/geojson-adapter.mjs';
import { routeBetween, runRouteTests } from '../tools/pedestrian-network/route-test.mjs';

const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/pedestrian-network-sample.geojson');
const dataset = {
  id: 'test_sidewalks',
  name: 'Test Sidewalks',
  jurisdiction: 'Test City',
  owner: 'Test GIS',
  classification_fields: ['TYPE'],
  classification_map: { 'public sidewalk': 'sidewalk', crosswalk: 'crossing' },
  default_access: 'allowed'
};

test('builder preserves raw features and only source-explicit crossings', async () => {
  const source = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const graph = buildPedestrianGraph(source, dataset, { snapToleranceMeters: 0.75 });
  assert.equal(graph.raw.features.length, 4);
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.edges.filter(({ edge_type }) => edge_type === 'crossing').length, 1);
  assert.equal(graph.rejected.length, 1);
  assert.ok(graph.edges.every(({ source_feature_id, derived_from_raw_feature_ids }) => derived_from_raw_feature_ids.includes(source_feature_id)));
  assert.ok(graph.nodes.every(({ source_ids }) => Array.isArray(source_ids) && source_ids.length));
  assert.ok(graph.edges.every(({ routable }) => routable === true));
});

test('nearby sidewalk endpoints remain disconnected outside conservative snap tolerance', async () => {
  const source = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const graph = buildPedestrianGraph(source, dataset, { snapToleranceMeters: 0.75 });
  const qa = buildQaReport(graph, dataset);
  assert.equal(qa.components, 2);
  assert.equal(qa.explicit_crossings, 1);
  assert.equal(qa.endpoint_gaps_under_2m, 1);
  assert.equal(qa.route_ready, false);
});

test('privatewalk stays unknown rather than becoming publicly routable', () => {
  const privateSource = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'private', properties: { TYPE: 'privatewalk' }, geometry: { type: 'LineString', coordinates: [[-71, 42], [-70.999, 42]] } }]
  };
  const graph = buildPedestrianGraph(privateSource, dataset);
  assert.equal(graph.edges[0].access, 'unknown');
  assert.equal(graph.edges[0].routable, false);
});

test('CLI writes the six raw, graph, QA, and provenance artifacts', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pedestrian-network-'));
  const registryPath = path.join(temporary, 'registry.json');
  await fs.writeFile(registryPath, JSON.stringify({ scope: 'walking_route_geometry_only', target_crs: 'EPSG:4326', datasets: [dataset] }));
  const result = await run(['--dataset', dataset.id, '--input', fixturePath, '--output', temporary, '--registry', registryPath]);
  const names = (await fs.readdir(result.outputDir)).sort();
  assert.deepEqual(names, ['graph.json', 'normalized_edges.geojson', 'normalized_nodes.geojson', 'provenance.json', 'qa_report.json', 'raw.geojson']);
  const provenance = JSON.parse(await fs.readFile(path.join(result.outputDir, 'provenance.json'), 'utf8'));
  assert.equal(provenance.policy.crossings_must_be_source_explicit, true);
  assert.equal(provenance.policy.human_route_truth_validation_complete, false);
});

test('CLI records source health instead of silently substituting geometry', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pedestrian-network-health-'));
  const unsupported = { ...dataset, id: 'unsupported_source', source_type: 'manual_download', dataset_url: 'https://example.test/sidewalks' };
  const registryPath = path.join(temporary, 'registry.json');
  await fs.writeFile(registryPath, JSON.stringify({ scope: 'walking_route_geometry_only', target_crs: 'EPSG:4326', datasets: [unsupported] }));
  await assert.rejects(run(['--dataset', unsupported.id, '--output', temporary, '--registry', registryPath]), /pass --input/);
  const health = JSON.parse(await fs.readFile(path.join(temporary, unsupported.id, 'source_health.json'), 'utf8'));
  assert.equal(health.ingest_status, 'source_unavailable');
  assert.equal(health.source_url, unsupported.dataset_url);
});

test('direct GeoJSON adapter validates the response and captures cache provenance', async () => {
  const source = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const fetchImpl = async () => new Response(JSON.stringify(source), {
    status: 200,
    headers: { 'content-type': 'application/geo+json', etag: 'fixture-v1', 'last-modified': 'Wed, 26 Aug 2026 12:00:00 GMT' }
  });
  const result = await fetchGeoJsonDataset({ id: 'direct', geojson_download_url: 'https://example.test/data.geojson' }, { fetchImpl });
  assert.equal(result.featureCollection.features.length, source.features.length);
  assert.equal(result.acquisition.content_etag, 'fixture-v1');
  assert.equal(result.acquisition.source_last_edit, 'Wed, 26 Aug 2026 12:00:00 GMT');
});

test('source-preserved networks keep each curved LineString as one edge', () => {
  const source = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 7, properties: { id: 7, flow: 42 }, geometry: { type: 'LineString', coordinates: [[-74, 40.7], [-73.9995, 40.7002], [-73.999, 40.7]] } }]
  };
  const graph = buildPedestrianGraph(source, {
    ...dataset,
    id: 'preserved',
    preserve_source_segments: true,
    default_edge_type: 'pedestrian_link',
    source_id_fields: ['id'],
    edge_attribute_fields: ['flow']
  }, { snapToleranceMeters: 0 });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].geometry.coordinates.length, 3);
  assert.equal(graph.edges[0].edge_type, 'pedestrian_link');
  assert.equal(graph.edges[0].source_attributes.flow, 42);
});

test('route harness returns graph geometry and typed failures without straight-line fallback', () => {
  const source = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'LineString', coordinates: [[-74, 40.7], [-73.999, 40.7]] } },
      { type: 'Feature', id: 'b', properties: {}, geometry: { type: 'LineString', coordinates: [[-73.999, 40.7], [-73.998, 40.7]] } },
      { type: 'Feature', id: 'island', properties: {}, geometry: { type: 'LineString', coordinates: [[-73.9, 40.8], [-73.899, 40.8]] } }
    ]
  };
  const graph = buildPedestrianGraph(source, { ...dataset, id: 'route_test', preserve_source_segments: true }, { snapToleranceMeters: 0 });
  const route = routeBetween(graph, [-74, 40.7], [-73.998, 40.7], { maxSnapMeters: 10 });
  assert.equal(route.status, 'ROUTE');
  assert.equal(route.edge_count, 2);
  assert.equal(route.coordinates.length, 3);
  assert.equal(routeBetween(graph, [-74, 40.7], [-73.9, 40.8], { maxSnapMeters: 10 }).status, 'NO_ROUTE');
  graph.edges.forEach((edge) => { edge.access = 'unknown'; });
  assert.equal(routeBetween(graph, [-74, 40.7], [-73.998, 40.7], { maxSnapMeters: 10 }).status, 'NO_ROUTE');
  const report = runRouteTests(graph, [{ id: 'override', origin: [-74, 40.7], destination: [-73.998, 40.7], expected_status: 'ROUTE' }], { includeUnknownAccess: true, maxSnapMeters: 10 });
  assert.deepEqual(report.summary, { total: 1, passed: 1, failed: 0 });
  assert.equal(report.human_route_truth_complete, false);
});

test('DVRPC line_type is authoritative for sidewalk, crossing, and trail classification', () => {
  const source = {
    type: 'FeatureCollection',
    features: [1, 2, 3].map((lineType, index) => ({
      type: 'Feature',
      properties: { globalid: `g-${lineType}`, line_type: lineType, feat_type: lineType === 2 ? 'CONTINENTAL' : 'PATH', last_edited_date: 1_700_000_000_000 },
      geometry: { type: 'LineString', coordinates: [[-75 + index * 0.001, 40], [-74.9995 + index * 0.001, 40]] }
    }))
  };
  const graph = buildPedestrianGraph(source, {
    ...dataset,
    id: 'dvrpc_fixture',
    preserve_source_segments: true,
    classification_fields: ['line_type'],
    classification_map: { '1': 'sidewalk', '2': 'crossing', '3': 'trail' },
    source_id_fields: ['globalid'],
    last_edit_fields: ['last_edited_date'],
    default_access: 'unknown'
  }, { snapToleranceMeters: 0 });
  assert.deepEqual(graph.edges.map(({ edge_type }) => edge_type), ['sidewalk', 'crossing', 'trail']);
  assert.equal(graph.edges[1].confidence, 'source_explicit');
  assert.equal(graph.edges[1].updated_at, '2023-11-14T22:13:20.000Z');
});
