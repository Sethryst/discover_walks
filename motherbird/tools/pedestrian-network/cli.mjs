#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fetchArcGisDataset } from './arcgis-adapter.mjs';
import { fetchGeoJsonDataset } from './geojson-adapter.mjs';
import { fetchNycSupplement } from './nyc-adapter.mjs';
import { buildPedestrianGraph } from './graph-builder.mjs';
import { buildQaReport } from './qa.mjs';
import { findDataset, loadRegistry } from './registry.mjs';
import { runRouteTests } from './route-test.mjs';
import { buildRuntimeGraph, writeRuntimePackage } from './runtime-package.mjs';
import { POLICY_VERSION } from './access-policy.mjs';

export async function run(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const registry = await loadRegistry(options.registry);
  const dataset = findDataset(registry, options.dataset);
  const retrievedAt = new Date().toISOString();
  const outputDir = path.resolve(options.output, dataset.id);
  await fs.mkdir(outputDir, { recursive: true });
  let featureCollection;
  let acquisition;
  try {
    if (options.inputZip) {
      ({ featureCollection, acquisition } = await fetchNycSupplement(dataset, options.inputZip));
    } else if (options.input) {
      featureCollection = JSON.parse(await fs.readFile(options.input, 'utf8'));
      if (options.bbox) featureCollection.features = featureCollection.features.filter((feature) => intersectsBbox(feature.geometry, options.bbox));
      acquisition = { method: 'local_geojson', source_last_edit: null, service_crs: 4326 };
    } else if (dataset.source_type === 'arcgis_feature_server') {
      ({ featureCollection, acquisition } = await fetchArcGisDataset(dataset, { envelope: options.bbox }));
    } else if (dataset.source_type === 'geojson_download') {
      ({ featureCollection, acquisition } = await fetchGeoJsonDataset(dataset));
    } else {
      throw new Error(`${dataset.id}: no automated adapter; pass --input <GeoJSON>`);
    }
  } catch (error) {
    await fs.writeFile(path.join(outputDir, 'source_health.json'), stableJson({
      registry_id: dataset.id,
      checked_at: retrievedAt,
      source_url: dataset.service_url || dataset.geojson_download_url || dataset.direct_download_url || dataset.dataset_url || dataset.acquisition_url,
      ingest_status: 'source_unavailable',
      error_type: error?.name || 'Error',
      error: error?.message || String(error)
    }));
    throw error;
  }
  const snapToleranceMeters = options.snapTolerance ?? dataset.default_snap_tolerance_m ?? 0.75;
  const graph = buildPedestrianGraph(featureCollection, dataset, { snapToleranceMeters });
  const qa = buildQaReport(graph, dataset, { sourceLastEdit: acquisition.source_last_edit });
  const routeReport = options.routeTests
    ? runRouteTests(graph, dataset.route_tests || [], { includeUnknownAccess: true, maxSnapMeters: 150 })
    : null;
  if (routeReport) qa.route_test_summary = routeReport.summary;
  const sourceHash = createHash('sha256');
  await writeFeatureCollection(path.join(outputDir, 'raw.geojson'), graph.raw.features, (feature) => feature, sourceHash);
  await writeFeatureCollection(path.join(outputDir, 'normalized_nodes.geojson'), graph.nodes, nodeFeature);
  await writeFeatureCollection(path.join(outputDir, 'normalized_edges.geojson'), graph.edges, edgeFeature);
  await writeGraph(path.join(outputDir, 'graph.json'), dataset.id, graph.nodes, graph.edges);
  let runtimeManifest = null;
  if (options.runtime) {
    const runtime = buildRuntimeGraph(graph, dataset, { builtAt: retrievedAt });
    runtimeManifest = await writeRuntimePackage(path.join(outputDir, 'runtime'), runtime, graph.edges);
  }
  const provenance = {
    schema_version: 1,
    registry_id: dataset.id,
    source_dataset_name: dataset.name,
    source_owner: dataset.owner,
    source_url: dataset.service_url || dataset.geojson_download_url || dataset.direct_download_url || dataset.dataset_url || dataset.acquisition_url,
    retrieved_at: retrievedAt,
    source_sha256: sourceHash.digest('hex'),
    source_feature_count: graph.raw.features.length,
    derived_edge_count: graph.edges.length,
    target_crs: registry.target_crs,
    source_where: dataset.where || '1=1',
    clip_method: dataset.clip_method || null,
    acquisition,
    policy: {
      raw_source_line_is_routable_edge: false,
      crossings_must_be_source_explicit: true,
      must_not_cross_unverified_roadways: true,
      raw_and_derived_layers_separate: true,
      access_policy_version: POLICY_VERSION,
      ordinary_walking_beta_allows_unknown_pedestrian_geometry_with_warning: true,
      verified_access_denies_unknown_access: true,
      topology_test_unknown_access_override: Boolean(routeReport),
      human_route_truth_validation_complete: false
    }
  };
  await Promise.all([
    atomicWrite(path.join(outputDir, 'qa_report.json'), stableJson(qa)),
    atomicWrite(path.join(outputDir, 'provenance.json'), stableJson(provenance)),
    ...(routeReport ? [atomicWrite(path.join(outputDir, 'route_test_report.json'), stableJson(routeReport))] : [])
  ]);
  process.stdout.write(`${JSON.stringify({ output: outputDir, qa, runtime: runtimeManifest, route_tests: routeReport?.summary || null }, null, 2)}\n`);
  return { outputDir, qa, provenance, runtimeManifest, routeReport };
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (key === '--route-tests' || key === '--runtime') values[key.slice(2)] = true;
    else values[key.slice(2)] = args[++index];
  }
  if (!values.dataset) throw new Error('Usage: cli.mjs --dataset <registry-id> [--input file.geojson | --input-zip supplement.zip] [--runtime] [--route-tests] [--output directory] [--snap-meters 0.75]');
  const snapTolerance = values['snap-meters'] === undefined ? undefined : Number(values['snap-meters']);
  if (snapTolerance !== undefined && !Number.isFinite(snapTolerance)) throw new Error('--snap-meters must be numeric');
  const bbox = values.bbox === undefined ? null : values.bbox.split(',').map(Number);
  if (bbox && (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value)))) throw new Error('--bbox must be xmin,ymin,xmax,ymax in EPSG:4326');
  return {
    dataset: values.dataset,
    input: values.input ? path.resolve(values.input) : null,
    inputZip: values['input-zip'] ? path.resolve(values['input-zip']) : null,
    output: path.resolve(values.output || 'pedestrian-network-out'),
    registry: values.registry ? path.resolve(values.registry) : undefined,
    snapTolerance,
    bbox,
    routeTests: Boolean(values['route-tests']),
    runtime: Boolean(values.runtime)
  };
}

function intersectsBbox(geometry, [xmin, ymin, xmax, ymax]) {
  const parts = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
  return parts.some((coordinates) => coordinates.some(([lon, lat]) => lon >= xmin && lon <= xmax && lat >= ymin && lat <= ymax));
}

function nodeFeature({ lon, lat, ...properties }) {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } };
}

function edgeFeature({ geometry, ...properties }) {
  return { type: 'Feature', properties, geometry };
}

async function writeFeatureCollection(filePath, items, project, hash = null) {
  await writeStreamedJson(filePath, '{"type":"FeatureCollection","features":[', items, project, ']}\n', hash);
}

async function writeGraph(filePath, datasetId, nodes, edges) {
  const temporaryPath = `${filePath}.tmp`;
  const handle = await fs.open(temporaryPath, 'w');
  try {
    await handle.write(`{"schema_version":1,"dataset_id":${JSON.stringify(datasetId)},"nodes":[`);
    await writeArray(handle, nodes, (value) => value);
    await handle.write('],"edges":[');
    await writeArray(handle, edges, (value) => value);
    await handle.write(']}\n');
  } finally {
    await handle.close();
  }
  await fs.rename(temporaryPath, filePath);
}

async function writeStreamedJson(filePath, prefix, items, project, suffix, hash = null) {
  const temporaryPath = `${filePath}.tmp`;
  const handle = await fs.open(temporaryPath, 'w');
  try {
    await writeChunk(handle, prefix, hash);
    await writeArray(handle, items, project, hash);
    await writeChunk(handle, suffix, hash);
  } finally {
    await handle.close();
  }
  await fs.rename(temporaryPath, filePath);
}

async function writeArray(handle, items, project, hash = null) {
  const batchSize = 500;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize).map(project).map(JSON.stringify).join(',');
    await writeChunk(handle, `${offset ? ',' : ''}${batch}`, hash);
  }
}

async function writeChunk(handle, chunk, hash) {
  await handle.write(chunk);
  hash?.update(chunk);
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
