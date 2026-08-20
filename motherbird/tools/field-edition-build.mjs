#!/usr/bin/env node
/** Build a bounded, self-contained Field Edition. Requires Docker for PMTiles. */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [editionId] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const dryRun = process.argv.includes('--dry-run');
if (!editionId) throw new Error('Usage: npm run build:field-edition -- <edition-id> [--dry-run]');
const editionRoot = path.join(root, 'field-editions', editionId);
const config = JSON.parse(await readFile(path.join(editionRoot, 'field-edition.json'), 'utf8'));
if (config.id !== editionId || !config.title || !config.boundary || !config.osm?.pbfUrl) throw new Error('Invalid Field Edition configuration.');
if (!Number.isInteger(config.zoomLevels?.min) || !Number.isInteger(config.zoomLevels?.max) || config.zoomLevels.min > config.zoomLevels.max) throw new Error('zoomLevels.min and zoomLevels.max must be valid integers.');
const boundaryFile = path.resolve(editionRoot, config.boundary);
const boundary = JSON.parse(await readFile(boundaryFile, 'utf8'));
const geometry = boundary.type === 'Feature' ? boundary.geometry : boundary;
if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error('Field Edition boundary must be a GeoJSON Polygon or MultiPolygon.');
const points = geometry.coordinates.flat(geometry.type === 'Polygon' ? 1 : 2);
const bbox = { west: Math.min(...points.map(([lng]) => lng)), south: Math.min(...points.map(([, lat]) => lat)), east: Math.max(...points.map(([lng]) => lng)), north: Math.max(...points.map(([, lat]) => lat)) };
const output = path.join(editionRoot, 'generated');
const staging = `${output}.staging-${Date.now()}`;
const cache = path.join(root, '.cache', 'field-editions', editionId, 'source.osm.pbf');
const clipped = path.join(staging, 'source-clipped.osm.pbf');
const map = path.join(staging, 'map.pmtiles');
const tileConfig = path.join(staging, 'tilemaker-config.json');
const exists = async (file) => access(file).then(() => true).catch(() => false);
const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false });
  child.on('error', () => reject(new Error(`${command} is required; start Docker Desktop and retry.`)));
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});
const digest = async (file) => `sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`;
const docker = (image, command) => ['run', '--rm', '-v', `${root}:/workspace`, '-w', '/workspace', image, ...command];

console.log(`Field Edition build: ${editionId}${dryRun ? ' (dry run)' : ''}`);
console.log(`Boundary bbox: ${bbox.west},${bbox.south},${bbox.east},${bbox.north}; zoom ${config.zoomLevels.min}-${config.zoomLevels.max}`);
if (dryRun) process.exit(0);
await run('docker', ['version', '--format', '{{.Server.Version}}']);
await mkdir(path.dirname(cache), { recursive: true });
if (!await exists(cache)) {
  const response = await fetch(config.osm.pbfUrl);
  if (!response.ok || !response.body) throw new Error(`OSM PBF download failed: ${response.status}`);
  await pipeline(response.body, createWriteStream(cache));
}
await mkdir(staging, { recursive: true });
try {
  await run('docker', docker('krizleebear/docker-osmium-tool:v1.18.0', ['osmium', 'extract', '--polygon', `/workspace/${rel(boundaryFile)}`, '--set-bounds', '--overwrite', '-o', `/workspace/${rel(clipped)}`, `/workspace/${rel(cache)}`]));
  // Tilemaker controls zoom levels through its JSON config, not CLI flags.
  await run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${root}:/workspace`, 'ghcr.io/systemed/tilemaker:master', '-c', `cp /usr/src/app/config.json /workspace/${rel(tileConfig)}`]);
  const tileSettings = JSON.parse(await readFile(tileConfig, 'utf8'));
  tileSettings.settings.minzoom = config.zoomLevels.min;
  tileSettings.settings.maxzoom = config.zoomLevels.max;
  tileSettings.settings.basezoom = config.zoomLevels.max;
  for (const layer of Object.values(tileSettings.layers)) {
    layer.minzoom = Math.max(config.zoomLevels.min, layer.minzoom ?? config.zoomLevels.min);
    layer.maxzoom = config.zoomLevels.max;
  }
  await writeFile(tileConfig, JSON.stringify(tileSettings));
  await run('docker', docker('ghcr.io/systemed/tilemaker:master', ['--input', `/workspace/${rel(clipped)}`, '--output', '/workspace/' + rel(map), '--bbox', `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`, '--config', `/workspace/${rel(tileConfig)}`, '--process', '/usr/src/app/process.lua']));
  if ((await readFile(map)).subarray(0, 7).toString('ascii') !== 'PMTiles') throw new Error('PMTiles generation failed validation.');
  for (const name of ['places.json', 'routes.json', 'stories.json', 'sources.json']) await cp(path.join(editionRoot, name), path.join(staging, name));
  await mkdir(path.join(staging, 'images'), { recursive: true });
  const artifacts = ['map.pmtiles', 'places.json', 'routes.json', 'stories.json', 'sources.json'];
  const manifest = { id: config.id, title: config.title, version: 1, generatedAt: new Date().toISOString(), geographicBounds: bbox, boundary: { geometry, artifact: 'boundary.geojson' }, zoomLevels: config.zoomLevels, dataSources: config.contentSources, offlineCapabilities: config.offlineCapabilities, artifacts: { map: 'map.pmtiles', places: 'places.json', routes: 'routes.json', stories: 'stories.json', images: 'images/', sources: 'sources.json' }, checksums: Object.fromEntries(await Promise.all(artifacts.map(async (name) => [name, await digest(path.join(staging, name))]))) };
  await cp(boundaryFile, path.join(staging, 'boundary.geojson'));
  await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Published bounded Field Edition: field-editions/${editionId}/generated/`);
} catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
