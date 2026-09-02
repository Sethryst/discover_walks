#!/usr/bin/env node
/**
 * Developer-only offline region packager. Requires Docker; the two pinned
 * container images run osmium (PBF clipping) and tilemaker (valid PMTiles).
 * It never imports browser/runtime modules.
 */
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { resolveBoundary } from './boundary-resolver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const regionId = args.find((arg) => !arg.startsWith('-'));
const dryRun = args.includes('--dry-run');
if (!regionId) throw new Error('Usage: npm run build:region -- <region-id> [--dry-run]');

const packagedConfigPath = path.join(root, 'regions', regionId, 'region.json');
// Build-only source configuration lives outside the published package folder.
// Publishing replaces that folder atomically, so keeping producer paths here
// both preserves future refreshes and prevents them shipping to runtime.
const buildConfigPath = path.join(root, 'region-build-configs', `${regionId}.json`);
let configPath = packagedConfigPath;
try { await access(buildConfigPath); configPath = buildConfigPath; } catch { /* static-only region */ }
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.id !== regionId) throw new Error(`region.json id must equal folder name (${regionId}), not ${config.id}`);
if (!config.name || !config.boundary?.source || !config.osm?.pbfUrl || !config.imports?.poi) {
  throw new Error('region.json requires name, boundary.source, osm.pbfUrl, and imports.poi');
}

const cacheDir = path.join(root, '.cache', 'region-build', regionId);
const staging = path.join(root, '.tmp', `region-${regionId}-${Date.now()}`);
const output = path.join(root, 'regions', regionId);
const pbf = path.join(cacheDir, 'source.osm.pbf');
const clipped = path.join(staging, `${regionId}.osm.pbf`);
const pmtiles = path.join(staging, `${regionId}.pmtiles`);
const boundary = await resolveBoundary(config.boundary, { root, cacheDir });
const { west, south, east, north } = boundary.bbox;

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', shell: false });
    child.on('error', (error) => reject(error.code === 'ENOENT'
      ? new Error(`Required build dependency '${command}' was not found. Install and start Docker Desktop, then retry.`)
      : error));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function verifyProducerManifest(manifestPath) {
  const rootDir = path.dirname(inputPath(manifestPath));
  const producer = JSON.parse(await readFile(inputPath(manifestPath), 'utf8'));
  for (const [artifact, expectedValue] of Object.entries(producer.checksums || {})) {
    const artifactPath = path.join(rootDir, artifact);
    const bytes = await readFile(artifactPath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    const expected = String(expectedValue).replace(/^sha256:/, '');
    if (actual !== expected) throw new Error(`Producer manifest checksum does not match ${artifact}`);
  }
  return producer;
}
async function download(url, file) {
  console.log(`Downloading OSM PBF: ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`PBF download failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) throw new Error(`PBF download returned ${contentType}, not an OSM PBF (${response.url})`);
  const temporary = `${file}.downloading`;
  await rm(temporary, { force: true });
  try {
    await pipeline(response.body, createWriteStream(temporary));
    if ((await stat(temporary)).size < 1024) throw new Error('PBF download is unexpectedly small');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
async function pmtilesIsValid(file) {
  const handle = await readFile(file);
  return handle.length > 127 && handle.subarray(0, 7).toString('ascii') === 'PMTiles';
}
async function osmPbfIsPlausible(file) {
  const header = await readFile(file);
  // OSM PBF starts with a four-byte big-endian BlobHeader length. Valid headers
  // are small; an HTML error page starts with '<' and must never enter cache.
  return header.length >= 1024 && header[0] === 0 && header[1] === 0 && header[2] === 0;
}
async function validatePackage(directory, manifest) {
  for (const artifact of [manifest.artifacts.pmtiles, manifest.artifacts.poi, manifest.artifacts.buckets, ...manifest.artifacts.supplemental]) {
    if (!artifact || path.isAbsolute(artifact) || artifact.includes('..')) throw new Error(`Invalid manifest artifact path: ${artifact}`);
    const bytes = await readFile(path.join(directory, artifact));
    const expected = String(manifest.checksums?.[artifact] || '').replace(/^sha256:/, '');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!expected || expected !== actual) throw new Error(`Package checksum validation failed for ${artifact}`);
  }
  if (!await pmtilesIsValid(path.join(directory, manifest.artifacts.pmtiles))) throw new Error('Package PMTiles header validation failed');
}

async function artifactChecksums(directory, artifacts) {
  const entries = await Promise.all(artifacts.map(async (artifact) => {
    const bytes = await readFile(path.join(directory, artifact));
    return [artifact, `sha256:${createHash('sha256').update(bytes).digest('hex')}`];
  }));
  return Object.fromEntries(entries);
}
function dockerArgs(image, command) {
  // Docker receives a stable POSIX mount even when the host is Windows.
  return ['run', '--rm', '-v', `${root}:/workspace`, '-w', '/workspace', image, ...command];
}
function relative(file) { return path.relative(root, file).replaceAll('\\', '/'); }
function inputPath(file) { return path.isAbsolute(file) ? file : path.join(root, file); }
async function importedPois(imports) {
  const source = imports.buildTimePoiSource || imports.poi;
  if (imports.producerManifest) {
    const producer = await verifyProducerManifest(imports.producerManifest);
    const warnings = Array.isArray(producer.warnings) ? producer.warnings : [];
    console.log(`Producer manifest: ${producer.producer?.name || 'unknown'} ${producer.producer?.version || ''}`.trim());
    warnings.forEach((warning) => console.warn(`Producer warning [${warning.code || 'unspecified'}]${warning.source ? ` (${warning.source})` : ''}: ${warning.detail || JSON.stringify(warning)}`));
    const bytes = await readFile(inputPath(source));
    const expected = producer.checksums?.['pois.json']?.replace(/^sha256:/, '');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!expected || expected !== actual) throw new Error(`Gremlin Lab producer manifest checksum does not match ${source}`);
    console.log(`Producer checksum verified: pois.json (${actual})`);
  }
  const bytes = await readFile(inputPath(source));
  const imported = JSON.parse(bytes);
  const pois = imported.pois || imported.pointsOfInterest;
  if (!Array.isArray(pois)) throw new Error(`POI import ${source} must contain a pois or pointsOfInterest array`);
  const allowed = imports.producerCategories;
  if (allowed && (!Array.isArray(allowed) || allowed.some((category) => typeof category !== 'string'))) throw new Error('imports.producerCategories must be an array of category names');
  // Verified events are portable, expiring local context. Import them from any
  // verified producer bundle even when a region's standing category list has
  // not yet been expanded, while all producer access stays build-time-only.
  const categorySelectedPois = allowed ? pois.filter((poi) => allowed.includes(poi.category) || poi.category === 'event') : pois;
  const selectedPois = categorySelectedPois.filter((poi) => poi.category !== 'event' || (
    typeof poi.id === 'string' && poi.id.length > 0 && Number.isFinite(poi.lat) && Number.isFinite(poi.lng)
    && typeof poi.startsAt === 'string' && poi.startsAt.length > 0 && typeof poi.endsAt === 'string' && poi.endsAt.length > 0
    && !poi.virtual && !poi.ambiguous
  ));
  if (allowed && categorySelectedPois.length !== pois.length) console.warn(`Producer import skipped ${pois.length - categorySelectedPois.length} POIs outside approved categories.`);
  if (selectedPois.length !== categorySelectedPois.length) console.warn(`Producer import skipped ${categorySelectedPois.length - selectedPois.length} event records without stable IDs, mapped coordinates, or start/end times.`);
  const localPois = imports.buildTimePoiSource ? JSON.parse(await readFile(inputPath(imports.poi), 'utf8')) : null;
  const localEntries = localPois ? (localPois.pois || localPois.pointsOfInterest || []) : [];
  const ids = new Set(localEntries.map((poi) => poi.id));
  return { pois: [...localEntries, ...selectedPois.filter((poi) => !ids.has(poi.id))], source };
}
async function importedCivic(imports) {
  if (!imports.buildTimePoiSource && !imports.civicReleaseRoot) return null;
  // A region may use a separately reviewed civic release. It has the same
  // checksum contract as a producer handoff, but remains a build-time file.
  const civicRoot = imports.civicReleaseRoot
    ? inputPath(imports.civicReleaseRoot)
    : path.join(path.dirname(inputPath(imports.buildTimePoiSource)), 'civic');
  const manifestPath = imports.civicProducerManifest || imports.producerManifest;
  const producer = manifestPath ? JSON.parse(await readFile(inputPath(manifestPath), 'utf8')) : null;
  const warnings = Array.isArray(producer?.warnings) ? producer.warnings : [];
  warnings.forEach((warning) => console.warn(`Civic producer warning [${warning.code || 'unspecified'}]${warning.source ? ` (${warning.source})` : ''}: ${warning.detail || JSON.stringify(warning)}`));
  const civic = {};
  for (const name of ['vote', 'meetings', 'volunteer', 'organizers', 'events', 'event-sources', 'volunteer-sources']) {
    const file = path.join(civicRoot, `${name}.json`);
    if (!await exists(file)) continue;
    const bytes = await readFile(file);
    const expected = producer?.checksums?.[`civic/${name}.json`]?.replace(/^sha256:/, '');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!expected || expected !== actual) throw new Error(`Civic producer manifest checksum does not match civic/${name}.json`);
    console.log(`Civic producer checksum verified: civic/${name}.json (${actual})`);
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (!Number.isInteger(envelope.schemaVersion) || !Array.isArray(envelope.items)) throw new Error(`Invalid civic/${name}.json envelope`);
    // Only a minimal, sourced, expiring public shape crosses the build boundary.
    const scalar = (value) => ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
    const opportunity = (item) => item?.id && item.title && item.date && item.type && item.summary && /^https:\/\//i.test(item.officialUrl || '') && item.expiresAt;
    civic[name] = { schemaVersion: envelope.schemaVersion, regionId: envelope.regionId, generatedAt: envelope.generatedAt, producer: envelope.producer,
      items: name === 'organizers'
        ? envelope.items.filter((item) => item?.id && item.name).map(({ id, name, officialUrl }) => ({ id, name, officialUrl: /^https:\/\//i.test(officialUrl || '') ? officialUrl : undefined }))
        : name.endsWith('-sources')
          ? envelope.items.filter((item) => item?.title && item?.summary && /^https:\/\//i.test(item.officialUrl || '')).map(({ id, title, summary, officialUrl }) => ({ id, title, summary, officialUrl }))
        : envelope.items.filter(opportunity).map(({ id, title, date, type, summary, officialUrl, expiresAt, jurisdiction, borough, lifecycle, organizer, participation, barriers, structure }) => ({ id, title, date, type, summary, officialUrl, expiresAt, jurisdiction, borough, lifecycle,
          organizer: organizer?.id && organizer.name ? { id: organizer.id, name: organizer.name } : undefined,
          participation: participation ? { whatYouWillDo: scalar(participation.whatYouWillDo), timeCommitment: scalar(participation.timeCommitment), riskClarity: scalar(participation.riskClarity) } : undefined,
          barriers: barriers ? { weekdayDaytime: scalar(barriers.weekdayDaytime), transitAccessible: scalar(barriers.transitAccessible), childcareProvided: scalar(barriers.childcareProvided) } : undefined,
          structure: structure && typeof structure === 'object' ? Object.fromEntries(Object.entries(structure).filter(([, value]) => scalar(value) !== undefined)) : undefined })) };
  }
  return Object.keys(civic).length ? civic : null;
}
async function importedWeather(imports) {
  // Weather is an optional producer artifact. When present beside a verified
  // POI release, it follows the same build-only checksum boundary as civic.
  const inferred = imports.buildTimePoiSource
    ? path.join(path.dirname(inputPath(imports.buildTimePoiSource)), 'supplemental', 'weather.json')
    : null;
  const file = imports.weatherReleaseFile ? inputPath(imports.weatherReleaseFile) : inferred;
  if (!file || !await exists(file)) return null;
  const manifest = JSON.parse(await readFile(inputPath(imports.weatherProducerManifest || imports.producerManifest), 'utf8'));
  const bytes = await readFile(file);
  const expected = manifest.checksums?.['supplemental/weather.json']?.replace(/^sha256:/, '');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!expected || expected !== actual) throw new Error('Weather producer manifest checksum does not match supplemental/weather.json');
  const weather = JSON.parse(bytes.toString('utf8'));
  if (!Number.isInteger(weather.schemaVersion) || !Array.isArray(weather.forecast) || !Array.isArray(weather.activeAlerts) || !weather.freshnessExpiresAt) throw new Error('Invalid supplemental/weather.json envelope');
  console.log(`Weather producer checksum verified: supplemental/weather.json (${actual})`);
  return weather;
}

console.log(`Region build: ${regionId}${dryRun ? ' (dry run)' : ''}`);
console.log(`Boundary: ${west},${south},${east},${north}`);
console.log(`Boundary source: ${boundary.sourceDescription}`);
console.log(`POI import: ${config.imports.buildTimePoiSource || config.imports.poi}`);
// Dry runs still validate the complete local producer handoff, but never
// start Docker or publish an artifact.
const imported = await importedPois(config.imports);
const civic = await importedCivic(config.imports);
const weather = await importedWeather(config.imports);
console.log(`POIs selected for package: ${imported.pois.length}`);
if (civic) console.log(`Civic artifacts selected for package: ${Object.keys(civic).join(', ')}`);
if (weather) console.log('Weather artifact selected for package');
if (dryRun) process.exit(0);

await run('docker', ['version', '--format', '{{.Server.Version}}']);
await mkdir(cacheDir, { recursive: true });
await mkdir(staging, { recursive: true });
try {
  if (await exists(pbf) && !await osmPbfIsPlausible(pbf)) await rm(pbf, { force: true });
  if (!await exists(pbf)) await download(config.osm.pbfUrl, pbf);
  const mountPbf = relative(pbf);
  const mountClipped = relative(clipped);
  const mountPolygon = relative(boundary.polygonFile);
  await run('docker', dockerArgs('krizleebear/docker-osmium-tool:v1.18.0', [
    'osmium', 'extract', '--polygon', `/workspace/${mountPolygon}`, '--set-bounds', '--overwrite',
    '-o', `/workspace/${mountClipped}`, `/workspace/${mountPbf}`
  ]));
  await run('docker', dockerArgs('ghcr.io/systemed/tilemaker:master', [
    '--input', `/workspace/${mountClipped}`, '--output', `/workspace/${relative(pmtiles)}`,
    '--bbox', `${west},${south},${east},${north}`,
    '--config', '/usr/src/app/config.json', '--process', '/usr/src/app/process.lua'
  ]));
  if (!await pmtilesIsValid(pmtiles)) throw new Error('tilemaker did not produce a valid PMTiles v3 archive');

  const { pois } = imported;
  await writeFile(path.join(staging, `${regionId}-poi.json`), JSON.stringify({ pois }, null, 2));
  const buckets = config.imports.buckets ? JSON.parse(await readFile(path.join(root, config.imports.buckets), 'utf8')) : { universalBuckets: [], featuredBuckets: [] };
  await writeFile(path.join(staging, `${regionId}-buckets.json`), JSON.stringify(buckets, null, 2));
  const supplemental = [];
  // Ship the resolved polygon so a published package remains self-describing
  // and cache-file definitions continue to work on its next rebuild.
  const boundaryArtifact = `${regionId}-boundary.geojson`;
  await cp(boundary.polygonFile, path.join(staging, boundaryArtifact));
  supplemental.push(boundaryArtifact);
  if (civic) {
    await mkdir(path.join(staging, 'civic'), { recursive: true });
    await writeFile(path.join(staging, 'civic', 'index.json'), JSON.stringify(civic, null, 2));
    supplemental.push('civic/index.json');
  }
  if (weather) {
    await writeFile(path.join(staging, 'weather.json'), JSON.stringify(weather, null, 2));
    supplemental.push('weather.json');
  }
  for (const item of config.imports.supplemental || []) {
    const source = path.join(root, item);
    const name = path.basename(item);
    await cp(source, path.join(staging, name));
    supplemental.push(name);
  }
  const artifacts = { pmtiles: `${regionId}.pmtiles`, poi: `${regionId}-poi.json`, buckets: `${regionId}-buckets.json`, supplemental };
  const manifest = {
    id: regionId, name: config.name, version: 1, generatedAt: new Date().toISOString(),
    boundary: { source: config.boundary.source, geometry: boundary.geometry, bbox: boundary.bbox }, source: { provider: 'OpenStreetMap', pbfUrl: config.osm.pbfUrl },
    artifacts,
    checksums: await artifactChecksums(staging, [artifacts.pmtiles, artifacts.poi, artifacts.buckets, ...artifacts.supplemental]),
    stats: { poiCount: pois.length }
  };
  await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // The build configuration may name an external producer, but the published
  // bundle must contain only the resolved local artifact—not a path that a
  // runtime could treat as a dependency on the producer's workspace.
  const packagedConfig = structuredClone(config);
  if (packagedConfig.imports?.buildTimePoiSource) {
    packagedConfig.imports.poi = `${regionId}-poi.json`;
    delete packagedConfig.imports.buildTimePoiSource;
    delete packagedConfig.imports.producerManifest;
    delete packagedConfig.imports.producerCategories;
  }
  await writeFile(path.join(staging, 'region.json'), JSON.stringify(packagedConfig, null, 2));
  await validatePackage(staging, manifest);
  const backup = `${output}.previous`;
  await rm(backup, { recursive: true, force: true });
  if (await exists(output)) await rename(output, backup);
  await rename(staging, output);
  await rm(backup, { recursive: true, force: true });
  console.log(`✓ Published valid region package: regions/${regionId}/`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
