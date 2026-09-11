#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { resolveBoundary } from '../boundary-resolver.mjs';
import { buildPedestrianGraph } from './graph-builder.mjs';
import { buildRuntimeGraph, writeRuntimePackage } from './runtime-package.mjs';
import { convertOsmPbf } from './osm-pbf-adapter.mjs';
import { clipFeatureCollection, geometryBounds, validateBoundary } from './region-geometry.mjs';
import { applyOsmBarrierRestrictions, createRegionalDataset, mergeAuthoritativeAndOsm, normalizeAuthoritative, normalizeOsm } from './regional-normalizer.mjs';
import { readPmtilesHeader, readPmtilesMetadata, writeWalkNetworkPmtiles } from './pmtiles-writer.mjs';

export const PRODUCER_VERSION = 'motherbird-pedestrian-network-producer-v1.0.0';
export const PACKAGE_FORMAT = 'motherbird-offline-walk-package-v1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildRegionPedestrianNetwork(options) {
  const configPath = path.resolve(options.config);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`Region config is missing: ${configPath}`);
    throw error;
  }));
  validateConfig(config);
  const destination = path.resolve(options.output || path.join(root, 'pedestrian-network-out', config.id));
  const staging = path.join(path.dirname(destination), `.${path.basename(destination)}.building-${process.pid}`);
  if (await exists(destination) && !options.force) throw new Error(`Output already exists: ${destination}. Pass --force to replace it.`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    const boundaryResult = await resolveBoundary(config.boundary, { root, cacheDir: path.join(staging, '_work', 'boundary') });
    const boundary = validateBoundary(boundaryResult.geometry);
    const bounds = geometryBounds(boundary);
    const boundaryBytes = Buffer.from(`${stableStringify({ type: 'Feature', properties: {}, geometry: boundary })}\n`);
    const boundarySha = sha256(boundaryBytes);
    await fs.writeFile(path.join(staging, 'boundary.geojson'), boundaryBytes);

    const authoritativeResult = await loadAuthoritative(config, options, boundary);
    const osmResult = await loadOsm(config, options, boundary, staging);
    const normalizedOsm = normalizeOsm(osmResult.collection, { id: 'openstreetmap' }, {
      includeRoadCenterlines: config.pedestrianNetwork?.includeRoadCenterlines !== false
    });
    const barrierRestrictions = applyOsmBarrierRestrictions(normalizedOsm.network, normalizedOsm.barriers);
    const merged = mergeAuthoritativeAndOsm(authoritativeResult.features, normalizedOsm.network, {
      overlapToleranceMeters: config.pedestrianNetwork?.overlapToleranceMeters ?? 2
    });
    const normalizedFeatures = merged.features.sort((left, right) => left.properties._mb_source_feature_id.localeCompare(right.properties._mb_source_feature_id));
    if (!normalizedFeatures.length) throw new Error('No clipped, walkable authoritative or OSM geometry remains for the configured boundary.');
    const normalized = { type: 'FeatureCollection', features: normalizedFeatures };
    const sourceHash = createHash('sha256');
    sourceHash.update(PRODUCER_VERSION);
    sourceHash.update(stableStringify({
      region: config.id,
      boundary_sha256: boundarySha,
      authoritative_inputs: authoritativeResult.inputs.map(({ id, sha256: checksum }) => ({ id, sha256: checksum })),
      osm_input_sha256: osmResult.input.sha256,
      normalization: config.pedestrianNetwork || {}
    }));
    for (const feature of normalizedFeatures) sourceHash.update(stableStringify(feature));
    const sourceVersion = `mbwalk-src-${sourceHash.digest('hex').slice(0, 24)}`;
    await fs.writeFile(path.join(staging, 'normalized-source.geojson'), `${stableStringify(normalized)}\n`);

    const dataset = createRegionalDataset(config);
    const graph = buildPedestrianGraph(normalized, dataset, {
      snapToleranceMeters: config.pedestrianNetwork?.snapToleranceMeters ?? 0.75
    });
    if (!graph.edges.length) throw new Error('Pedestrian graph builder produced no edges.');
    const runtime = buildRuntimeGraph(graph, dataset, {
      builtAt: osmResult.acquisition.source_timestamp || config.pedestrianNetwork?.sourceTimestamp || null,
      sourceVersion
    });
    const runtimeManifest = await writeRuntimePackage(path.join(staging, 'routing-runtime'), runtime, graph.edges);
    const pmtilesReport = await writeWalkNetworkPmtiles(path.join(staging, 'walk-network.pmtiles'), graph, normalizedOsm.barriers, {
      bounds,
      sourceVersion,
      producerVersion: PRODUCER_VERSION,
      name: `${config.name} walk network`,
      attribution: [...new Set([...authoritativeResult.inputs.map(({ owner }) => owner).filter(Boolean), 'OpenStreetMap contributors'])].join('; '),
      zoom: config.pedestrianNetwork?.tileZoom ?? 14
    });
    const counts = countGraph(graph, normalizedOsm.barriers, authoritativeResult.features, normalizedOsm.network);
    const provenance = {
      format: 'motherbird-walk-network-provenance-v1',
      producer_version: PRODUCER_VERSION,
      source_version: sourceVersion,
      graph_version: runtime.graph_version,
      deterministic_build: true,
      region: { id: config.id, name: config.name, boundary_source: boundaryResult.sourceDescription, bounds, boundary_sha256: boundarySha },
      sources: {
        authoritative: authoritativeResult.inputs,
        osm: { ...osmResult.input, ...osmResult.acquisition, pbf_url: config.osm.pbfUrl || null }
      },
      merge: {
        policy: 'authoritative_first_osm_supplement_second',
        overlap_tolerance_m: config.pedestrianNetwork?.overlapToleranceMeters ?? 2,
        overlaps_suppressed: merged.overlaps,
        access_conflicts_cautiously_blocked: merged.conflicts,
        osm_barrier_restrictions: barrierRestrictions
      },
      counts,
      rejected: { graph: graph.rejected, osm: normalizedOsm.skipped },
      pmtiles: pmtilesReport,
      runtime: { graph_hash: runtime.graph_hash, package: runtimeManifest }
    };
    await fs.writeFile(path.join(staging, 'provenance.json'), `${stableStringify(provenance)}\n`);
    const artifactFiles = ['walk-network.pmtiles', 'routing-runtime/runtime-graph.json', 'routing-runtime/manifest.json', 'normalized-source.geojson', 'provenance.json', 'boundary.geojson'];
    const checksums = Object.fromEntries(await Promise.all(artifactFiles.map(async (name) => [name, `sha256:${await fileSha256(path.join(staging, ...name.split('/')))}`])));
    const manifest = {
      format: PACKAGE_FORMAT,
      package_version: `${PRODUCER_VERSION}+${sourceVersion}`,
      source_version: sourceVersion,
      graph_version: runtime.graph_version,
      producer_version: PRODUCER_VERSION,
      bounds,
      counts,
      source_metadata: provenance.sources,
      artifacts: {
        walk_network: { path: './walk-network.pmtiles', format: 'pmtiles', source_version: sourceVersion },
        routing_runtime: { path: './routing-runtime/runtime-graph.json', format: 'motherbird-runtime-graph-v1', source_version: sourceVersion }
      },
      checksums
    };
    await fs.writeFile(path.join(staging, 'manifest.json'), `${stableStringify(manifest)}\n`);
    await validateOutput(staging, manifest);
    await fs.rm(path.join(staging, '_work'), { recursive: true, force: true });
    if (await exists(destination)) await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(staging, destination);
    return { outputDir: destination, manifest, provenance };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function loadAuthoritative(config, options, boundary) {
  const configured = config.pedestrianNetwork?.authoritativeSources || [];
  const sources = options.authoritative
    ? [{ ...(configured[0] || {}), id: configured[0]?.id || 'authoritative_local', file: options.authoritative }]
    : configured;
  const features = [];
  const inputs = [];
  for (const source of sources) {
    if (!source.id || !source.file) throw new Error('Every pedestrianNetwork.authoritativeSources entry requires id and file.');
    const file = resolveInputPath(source.file);
    const bytes = await fs.readFile(file).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`Configured authoritative pedestrian source is missing: ${file}`);
      throw error;
    });
    const parsed = parseFeatureCollection(bytes, `Authoritative source ${source.id}`);
    const clipped = clipFeatureCollection(parsed, boundary);
    const normalized = normalizeAuthoritative(clipped, source);
    if (!normalized.length) throw new Error(`Authoritative pedestrian source '${source.id}' has no line geometry inside the configured boundary.`);
    // A county-scale authoritative feed can contain hundreds of thousands of
    // features.  Spreading that array into push exceeds V8's argument limit;
    // append iteratively so large regional inputs remain buildable.
    for (const feature of normalized) features.push(feature);
    inputs.push({ id: source.id, owner: source.owner || null, source_url: source.url || null, file: path.basename(file), sha256: sha256(bytes), raw_feature_count: parsed.features.length, clipped_feature_count: clipped.features.length, normalized_feature_count: normalized.length });
  }
  return { features, inputs };
}

async function loadOsm(config, options, boundary, staging) {
  if (options.osmGeojson) {
    const file = path.resolve(options.osmGeojson);
    const bytes = await fs.readFile(file).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`OSM GeoJSON adapter input is missing: ${file}`);
      throw error;
    });
    const parsed = parseFeatureCollection(bytes, 'OSM GeoJSON adapter input');
    return {
      collection: clipFeatureCollection(parsed, boundary),
      acquisition: { method: 'local_osm_geojson_adapter', adapter: 'motherbird-osm-geojson-v1', source_timestamp: config.pedestrianNetwork?.sourceTimestamp || null },
      input: { kind: 'osm_geojson_adapter', file: path.basename(file), sha256: sha256(bytes), raw_feature_count: parsed.features.length }
    };
  }
  const cacheDir = path.join(root, '.cache', 'pedestrian-network', config.id);
  await fs.mkdir(cacheDir, { recursive: true });
  const pbf = options.pbf ? path.resolve(options.pbf) : path.join(cacheDir, 'source.osm.pbf');
  if (!options.pbf && !await exists(pbf)) await downloadPbf(config.osm.pbfUrl, pbf);
  const inputSha = await fileSha256(pbf).catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`OSM PBF input is missing: ${pbf}`);
    throw error;
  });
  const converted = await convertOsmPbf(pbf, path.join(staging, '_work', 'boundary', 'boundary.geojson'), path.join(staging, '_work', 'osm'), { osmiumPath: options.osmiumPath });
  return {
    collection: clipFeatureCollection(converted.featureCollection, boundary),
    acquisition: converted.acquisition,
    input: { kind: 'osm_pbf', file: path.basename(pbf), sha256: inputSha, raw_feature_count: converted.featureCollection.features.length }
  };
}

async function validateOutput(directory, manifest) {
  const networkPath = path.join(directory, 'walk-network.pmtiles');
  const runtimePath = path.join(directory, 'routing-runtime', 'runtime-graph.json');
  const pmtilesBytes = await fs.readFile(networkPath).catch(() => { throw new Error('Required output artifact is missing: walk-network.pmtiles'); });
  const header = readPmtilesHeader(pmtilesBytes);
  const metadata = readPmtilesMetadata(pmtilesBytes);
  if (header.tile_type !== 1 || !header.addressed_tiles) throw new Error('walk-network.pmtiles is not a non-empty MVT PMTiles archive.');
  if (metadata.source_version !== manifest.source_version) throw new Error('walk-network.pmtiles metadata source_version does not match the package manifest.');
  const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf8').catch(() => { throw new Error('Required output artifact is missing: routing-runtime/runtime-graph.json'); }));
  if (runtime.graph_version !== manifest.graph_version || runtime.source_version !== manifest.source_version) throw new Error('Routing runtime versions do not match the package manifest.');
  for (const [name, expectedValue] of Object.entries(manifest.checksums)) {
    const actual = await fileSha256(path.join(directory, ...name.split('/')));
    if (actual !== expectedValue.replace(/^sha256:/, '')) throw new Error(`Output checksum validation failed for ${name}.`);
  }
}

function countGraph(graph, barriers, authoritative, osm) {
  const byEdgeType = {};
  const byAccess = {};
  for (const edge of graph.edges) {
    byEdgeType[edge.edge_type] = (byEdgeType[edge.edge_type] || 0) + 1;
    byAccess[edge.raw_access] = (byAccess[edge.raw_access] || 0) + 1;
  }
  return {
    normalized_features: graph.raw.features.length,
    authoritative_features: authoritative.length,
    osm_supplement_features: osm.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    barriers_and_crossing_nodes: barriers.length,
    rejected: graph.rejected.length,
    edge_types: byEdgeType,
    access: byAccess
  };
}

function validateConfig(config) {
  if (!config?.id || !config.name) throw new Error('Region config requires id and name.');
  if (!config.boundary?.source) throw new Error('Region config requires a polygon boundary; boundary.source is missing.');
  if (!config.osm?.pbfUrl) throw new Error('Region config requires osm.pbfUrl.');
  if (config.id === 'fairfax-county-va' && !config.pedestrianNetwork?.authoritativeSources?.length) {
    throw new Error('Fairfax pedestrian builds require pedestrianNetwork.authoritativeSources so official sidewalk centerlines are merged before OSM.');
  }
}

function parseFeatureCollection(bytes, label) {
  let parsed;
  try { parsed = JSON.parse(bytes); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) throw new Error(`${label} must be a GeoJSON FeatureCollection.`);
  return parsed;
}

async function downloadPbf(url, file) {
  if (!url) throw new Error('No local --pbf was supplied and the region config has no osm.pbfUrl.');
  const response = await fetch(url, { headers: { 'User-Agent': `${PRODUCER_VERSION} MotherBird` }, signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`OSM PBF download failed: HTTP ${response.status} ${response.statusText}`.trim());
  const contentType = response.headers.get('content-type') || '';
  if (/text\/html|application\/json/i.test(contentType)) throw new Error(`OSM PBF download returned ${contentType}, not an OSM PBF.`);
  const temporary = `${file}.downloading`;
  await fs.rm(temporary, { force: true });
  try {
    await pipeline(response.body, createWriteStream(temporary));
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (key === '--force') values.force = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
      values[key.slice(2)] = value;
    }
  }
  if (!values.config) throw new Error('Usage: producer.mjs --config <region-config.json> [--pbf source.osm.pbf | --osm-geojson fixture.geojson] [--authoritative sidewalks.geojson] [--output directory] [--force]');
  if (values.pbf && values['osm-geojson']) throw new Error('Choose either --pbf or --osm-geojson, not both.');
  return { config: values.config, output: values.output, pbf: values.pbf, osmGeojson: values['osm-geojson'], authoritative: values.authoritative, osmiumPath: values.osmium, force: Boolean(values.force) };
}

function resolveInputPath(file) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function stableStringify(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  buildRegionPedestrianNetwork(parseArgs(process.argv.slice(2)))
    .then(({ outputDir, manifest }) => process.stdout.write(`${JSON.stringify({ output: outputDir, source_version: manifest.source_version, graph_version: manifest.graph_version, counts: manifest.counts }, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
