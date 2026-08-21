#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Flatbush from 'flatbush';
import { streamGeoJsonFeatures } from './federal-regions/geojson-stream.mjs';
import { geometryBbox, simplifyGeometry } from './federal-regions/geometry.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FEDERAL_REGION_SCHEMA_VERSION = 1;
export const FLATBUSH_VERSION = '4.6.2';
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export async function buildFederalRegions({
  sourceRoot = path.join(projectRoot, 'federal-core', 'artifacts', 'national'),
  outputRoot = path.join(projectRoot, 'federal-core', 'artifacts', 'nationwide-regions'),
  congressionalSources,
  previousCongressionalSource,
  generatedAt
} = {}) {
  const sourceManifestPayload = await readFile(path.join(sourceRoot, 'producer-manifest.json'));
  const sourceManifest = JSON.parse(sourceManifestPayload);
  generatedAt ||= sourceManifest.generatedAt;
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error('A reproducible ISO generatedAt timestamp is required.');

  const sourceArtifacts = new Map(sourceManifest.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const layer of ['states', 'counties', 'congressional-districts']) {
    if (!sourceArtifacts.has(layer)) throw new Error(`Nationwide source manifest is missing ${layer}.`);
  }
  const currentCongress = congressFromVintage(sourceArtifacts.get('congressional-districts').vintage);
  const defaultCongressionalSource = {
    congress: currentCongress,
    filename: path.join(sourceRoot, sourceArtifacts.get('congressional-districts').filename),
    artifact: sourceArtifacts.get('congressional-districts')
  };
  const selectedCdSources = (congressionalSources || [defaultCongressionalSource, ...(previousCongressionalSource ? [previousCongressionalSource] : [])])
    .map((source) => ({ ...source, congress: Number(source.congress) }))
    .sort((left, right) => right.congress - left.congress)
    .filter((source, index, all) => index === all.findIndex((candidate) => candidate.congress === source.congress))
    .slice(0, 2);
  if (!selectedCdSources.length || selectedCdSources.some((source) => !Number.isInteger(source.congress))) throw new Error('Congressional sources require integer Congress numbers.');
  const cdSources = await Promise.all(selectedCdSources.map(async (source) => ({ ...source, checksum: source.artifact?.checksum || source.checksum || await sha256File(source.filename) })));

  const publishedOutputRoot = outputRoot;
  outputRoot = `${publishedOutputRoot}.staging`;
  assertSafeDerivedOutput(publishedOutputRoot);
  assertSafeDerivedOutput(outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const canonicalWriters = new Map();
  const baseNational = [];
  const baseStates = new Map();
  const congressBuckets = new Map(cdSources.map(({ congress }) => [congress, { national: [], states: new Map() }]));
  const counts = { states: 0, counties: 0, congressionalDistricts: {}, excludedCongressionalPlaceholders: {} };

  const getWriter = async (relativeFilename) => {
    if (!canonicalWriters.has(relativeFilename)) {
      const writer = new FeatureCollectionWriter(path.join(outputRoot, relativeFilename));
      await writer.open();
      canonicalWriters.set(relativeFilename, writer);
    }
    return canonicalWriters.get(relativeFilename);
  };

  try {
  for (const layer of ['states', 'counties']) {
    const artifact = sourceArtifacts.get(layer);
    const filename = path.join(sourceRoot, artifact.filename);
    for await (const feature of streamGeoJsonFeatures(filename)) {
      const normalized = normalizeFeature(feature, layer);
      const { stateFips } = normalized.properties;
      const canonicalPath = `canonical/base/states/${stateFips}/${layer}.geojson`;
      await (await getWriter(canonicalPath)).write(normalized);
      addDisplayFeature(baseNational, baseStates, normalized, nationalTolerance(layer), 0.006);
      counts[layer] += 1;
    }
  }

  for (const source of cdSources) {
    const buckets = congressBuckets.get(source.congress);
    counts.congressionalDistricts[source.congress] = 0;
    counts.excludedCongressionalPlaceholders[source.congress] = 0;
    for await (const feature of streamGeoJsonFeatures(source.filename)) {
      const normalized = normalizeFeature(feature, 'congressional-districts', source.congress);
      if (!normalized) { counts.excludedCongressionalPlaceholders[source.congress] += 1; continue; }
      const { stateFips } = normalized.properties;
      const canonicalPath = `canonical/congress/${source.congress}/states/${stateFips}/congressional-districts.geojson`;
      await (await getWriter(canonicalPath)).write(normalized);
      addDisplayFeature(buckets.national, buckets.states, normalized, 0.04, 0.006);
      counts.congressionalDistricts[source.congress] += 1;
    }
  }
  await Promise.all([...canonicalWriters.values()].map((writer) => writer.close()));

  const shards = { base: { national: null, states: {} }, congress: {} };
  shards.base.national = await writeShard(outputRoot, 'base/national/z0-4', baseNational, { zoom: [0, 4] });
  for (const [stateFips, features] of [...baseStates].sort()) {
    shards.base.states[stateFips] = await writeShard(outputRoot, `base/states/${stateFips}/z5-7`, features, { zoom: [5, 7], stateFips });
  }
  for (const { congress } of cdSources) {
    const buckets = congressBuckets.get(congress);
    const version = { national: await writeShard(outputRoot, `congress/${congress}/national/z0-4`, buckets.national, { zoom: [0, 4], congress }), states: {} };
    for (const [stateFips, features] of [...buckets.states].sort()) {
      version.states[stateFips] = await writeShard(outputRoot, `congress/${congress}/states/${stateFips}/z5-7`, features, { zoom: [5, 7], stateFips, congress });
    }
    shards.congress[String(congress)] = version;
  }

  const manifest = {
    schemaVersion: FEDERAL_REGION_SCHEMA_VERSION,
    artifactType: 'nationwide-federal-region-shards',
    generatedAt,
    layers: ['state', 'county', 'congressional_district'],
    zoomPolicy: { national: [0, 4], state: [5, 7], zoom8Plus: 'state-shards-until-municipal-module' },
    geometryPolicy: { display: 'derived-simplified', exactJoins: 'canonical-only', indexRole: 'candidate-prefilter-only' },
    congressPolicy: {
      current: cdSources[0].congress,
      hot: cdSources.map(({ congress }) => congress),
      retentionLimit: 2,
      sources: cdSources.map((source) => ({ congress: source.congress, acquisition: source.artifact?.acquisition?.method || source.acquisition || 'provided-local-artifact', checksum: source.checksum }))
    },
    identity: {
      state: 'us-state:{state_fips}',
      county: 'us-county:{state_fips}:{county_fips}',
      congressionalDistrict: 'us-cd:{congress}:{state_fips}:{district}'
    },
    acquisition: {
      policy: 'bulk-cartographic-first-rest-pagination-fallback',
      observed: Object.fromEntries(sourceManifest.artifacts.filter((artifact) => artifact.id !== 'fema-nfhl').map((artifact) => [artifact.id, artifact.acquisition?.method || 'unknown'])),
      sourceManifestChecksum: sha256(sourceManifestPayload)
    },
    exclusions: ['fema', 'municipal-plugins'],
    counts,
    provider: { name: 'flatbush', libraryVersion: FLATBUSH_VERSION, serializedFormatVersion: 3, nodeSize: 16 },
    coordinateOrder: 'minLng,minLat,maxLng,maxLat',
    shards,
    replay: `node tools/build-federal-regions.mjs${cdSources.length > 1 ? ` --previous-congress ${cdSources[1].congress} --previous-cd ${path.relative(projectRoot, cdSources[1].filename).replaceAll('\\', '/')}` : ''}`
  };
  await writeFile(path.join(outputRoot, 'manifest.json'), stableJson(manifest));
  await publishDerivedDirectory(outputRoot, publishedOutputRoot);
  return manifest;
  } catch (error) {
    await Promise.allSettled([...canonicalWriters.values()].map((writer) => writer.close()));
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
}

function normalizeFeature(feature, layer, congress) {
  const source = feature.properties?.source_properties || feature.properties || {};
  const stateFips = String(source.STATE || source.STATEFP || (layer === 'states' ? source.GEOID : '')).padStart(2, '0');
  if (!/^\d{2}$/.test(stateFips)) throw new Error(`${layer}: feature lacks a two-digit state FIPS.`);
  let id; let boundaryType; let extra = {};
  if (layer === 'states') {
    id = `us-state:${stateFips}`; boundaryType = 'state';
  } else if (layer === 'counties') {
    const countyFips = String(source.COUNTY || String(source.GEOID || '').slice(2)).padStart(3, '0');
    if (!/^\d{3}$/.test(countyFips)) throw new Error('County feature lacks a three-digit county FIPS.');
    id = `us-county:${stateFips}:${countyFips}`; boundaryType = 'county'; extra = { countyFips };
  } else {
    const district = String(source[`CD${congress}`] || source[`CD${congress}FP`] || String(source.GEOID || '').slice(2) || source.BASENAME || '').padStart(2, '0');
    // TIGER can carry transitional ZZ polygons such as "districts not defined".
    // They are not congressional districts and cannot satisfy the public identity contract.
    if (/^[A-Z]{2}$/.test(district)) return null;
    if (!/^\d{2}$/.test(district)) throw new Error(`Congress ${congress}: district lacks a supported two-digit Census code.`);
    id = `us-cd:${congress}:${stateFips}:${district}`; boundaryType = 'congressional_district'; extra = { congress, district };
  }
  return {
    type: 'Feature', id,
    properties: {
      ...feature.properties,
      boundary_id: id,
      boundary_type: boundaryType,
      name: feature.properties?.name || source.NAME || source.NAMELSAD || source.BASENAME,
      stateFips,
      ...extra,
      source_boundary_id: feature.properties?.boundary_id || feature.id
    },
    geometry: feature.geometry
  };
}

function addDisplayFeature(national, states, canonical, nationalToleranceValue, stateTolerance) {
  const stateFips = canonical.properties.stateFips;
  const create = (tolerance) => {
    const geometry = simplifyGeometry(canonical.geometry, tolerance);
    const bbox = geometryBbox(geometry);
    const { boundary_id: boundaryId, boundary_type: boundaryType, name, countyFips, congress, district } = canonical.properties;
    return { type: 'Feature', id: boundaryId, properties: { boundary_id: boundaryId, boundary_type: boundaryType, name, stateFips, countyFips, congress, district, bbox }, geometry };
  };
  national.push(create(nationalToleranceValue));
  if (!states.has(stateFips)) states.set(stateFips, []);
  states.get(stateFips).push(create(stateTolerance));
}

async function writeShard(root, relativeDirectory, features, scope) {
  if (!features.length) throw new Error(`${relativeDirectory}: refusing to write an empty shard.`);
  features.sort((left, right) => left.id.localeCompare(right.id));
  const directory = path.join(root, relativeDirectory);
  await mkdir(directory, { recursive: true });
  const records = features.map((feature) => ({ id: feature.id, boundaryType: feature.properties.boundary_type, stateFips: feature.properties.stateFips, bbox: feature.properties.bbox }));
  const index = new Flatbush(records.length);
  records.forEach((record) => index.add(...record.bbox));
  index.finish();
  const display = Buffer.from(stableJson({ type: 'FeatureCollection', features }));
  const binary = Buffer.from(index.data);
  const sidecar = Buffer.from(stableJson({ schemaVersion: 1, kind: 'federal-region-id-sidecar', records }));
  await Promise.all([
    writeFile(path.join(directory, 'display.geojson'), display),
    writeFile(path.join(directory, 'boundaries.flatbush'), binary),
    writeFile(path.join(directory, 'boundaries.ids.json'), sidecar)
  ]);
  const relative = relativeDirectory.replaceAll('\\', '/');
  return {
    ...scope,
    display: `${relative}/display.geojson`, index: `${relative}/boundaries.flatbush`, ids: `${relative}/boundaries.ids.json`,
    featureCount: features.length, displayChecksum: sha256(display), indexChecksum: sha256(binary), idsChecksum: sha256(sidecar)
  };
}

class FeatureCollectionWriter {
  constructor(filename) { this.filename = filename; this.handle = null; this.count = 0; this.closed = false; }
  async open() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    this.handle = await open(this.filename, 'w');
    await this.handle.write('{"type":"FeatureCollection","features":[');
  }
  async write(feature) {
    await this.handle.write(`${this.count ? ',' : ''}${JSON.stringify(feature)}`);
    this.count += 1;
  }
  async close() {
    if (!this.handle || this.closed) return;
    this.closed = true;
    await this.handle.write(']}\n');
    await this.handle.close();
  }
}

function assertSafeDerivedOutput(outputRoot) {
  const resolved = path.resolve(outputRoot);
  if (resolved === path.parse(resolved).root || resolved === projectRoot || path.basename(resolved).length < 4) throw new Error(`Unsafe derived output path: ${resolved}`);
}

async function publishDerivedDirectory(stagingRoot, publishedRoot) {
  const previousRoot = `${publishedRoot}.previous`;
  assertSafeDerivedOutput(previousRoot);
  await rm(previousRoot, { recursive: true, force: true });
  let movedPublished = false;
  try { await rename(publishedRoot, previousRoot); movedPublished = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(stagingRoot, publishedRoot); }
  catch (error) {
    if (movedPublished) await rename(previousRoot, publishedRoot);
    throw error;
  }
  if (movedPublished) await rm(previousRoot, { recursive: true, force: true });
}

const congressFromVintage = (vintage) => {
  const match = /(?:^|\D)(\d{3})(?:th|st|nd|rd)?(?:\D|$)/.exec(String(vintage));
  if (!match) throw new Error(`Cannot infer Congress from vintage ${vintage}.`);
  return Number(match[1]);
};
const nationalTolerance = (layer) => layer === 'states' ? 0.035 : 0.04;
const sha256File = (filename) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const input = createReadStream(filename);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('error', reject);
  input.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  const outputIndex = args.indexOf('--output');
  const generatedIndex = args.indexOf('--generated-at');
  const previousIndex = args.indexOf('--previous-cd');
  const previousCongressIndex = args.indexOf('--previous-congress');
  const manifest = await buildFederalRegions({
    sourceRoot: sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1]) : undefined,
    outputRoot: outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : undefined,
    previousCongressionalSource: previousIndex >= 0 ? {
      congress: previousCongressIndex >= 0 ? Number(args[previousCongressIndex + 1]) : 118,
      filename: path.resolve(args[previousIndex + 1]),
      acquisition: 'bulk-cartographic-boundary'
    } : undefined,
    generatedAt: generatedIndex >= 0 ? args[generatedIndex + 1] : undefined
  });
  console.log(`Federal regions: ${manifest.counts.states} states, ${manifest.counts.counties} counties/equivalents, Congress ${manifest.congressPolicy.hot.join(' + ')}; ${Object.keys(manifest.shards.base.states).length} state shards.`);
}

export const federalRegionBuildHelpers = { normalizeFeature, congressFromVintage };
