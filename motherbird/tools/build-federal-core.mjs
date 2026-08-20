#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArcGisClient } from './federal-core/arcgis-client.mjs';
import { acquireLayer } from './federal-core/adapters.mjs';
import { compileLayer, sha256 } from './federal-core/artifact-contract.mjs';
import { writeTiledArtifact } from './federal-core/tiled-artifact-writer.mjs';
import { inspectSourceContract } from './federal-core/source-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const scope = args.includes('--national') ? 'national' : 'dc';
const skipFema = args.includes('--skip-fema');
const generatedAtIndex = args.indexOf('--generated-at');
const generatedAt = generatedAtIndex >= 0 ? args[generatedAtIndex + 1] : process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();
if (Number.isNaN(Date.parse(generatedAt))) throw new Error('--generated-at must be an ISO-8601 timestamp');

const config = JSON.parse(await readFile(path.join(root, 'federal-core', 'sources.json'), 'utf8'));
const output = path.join(root, 'federal-core', 'artifacts', scope);
const client = new ArcGisClient();
await mkdir(output, { recursive: true });

const built = [];
const unavailableLayers = [];
for (const source of config.layers) {
  if (source.id === 'fema-nfhl' && skipFema) {
    unavailableLayers.push({ id: source.id, status: 'explicitly-skipped', sourceUrl: source.service });
    continue;
  }
  const sourceMetadata = await inspectSourceContract(client, source);
  if (scope === 'national' && source.adapter === 'fema-nfhl-tiled') {
    const descriptor = await writeTiledArtifact(client, source, scope, generatedAt, output, sourceMetadata);
    built.push(descriptor);
    console.log(`Federal Core ${scope}: ${source.id}=${descriptor.tileCount} bounded-memory tiles`);
    continue;
  }
  const { features, stats } = await acquireLayer(client, source, scope);
  stats.sourceMetadata = sourceMetadata;
  if (!features.length) throw new Error(`${source.id}: empty federal source result`);
  const artifact = compileLayer(source, scope, generatedAt, features, stats);
  const filename = `${source.id}.geojson`;
  const payload = `${JSON.stringify(artifact)}\n`;
  await writeFile(path.join(output, filename), payload);
  built.push({
    id: source.id,
    filename,
    featureCount: artifact.features.length,
    checksum: sha256(payload),
    vintage: source.vintage,
    sourceUrl: source.service,
    acquisition: stats
  });
  console.log(`Federal Core ${scope}: ${source.id}=${artifact.features.length} via ${stats.method}`);
}

const manifest = {
  schemaVersion: 2,
  artifactType: 'federal-core-manifest',
  scope,
  generatedAt,
  reproducibility: {
    timestampInput: generatedAtIndex >= 0 ? '--generated-at' : process.env.SOURCE_DATE_EPOCH ? 'SOURCE_DATE_EPOCH' : 'system-clock',
    deterministicOrdering: true,
    replay: `node tools/build-federal-core.mjs${scope === 'national' ? ' --national' : ''} --generated-at ${generatedAt}${skipFema ? ' --skip-fema' : ''}`
  },
  sourcePolicy: config.policy,
  artifacts: built,
  unavailableLayers,
  aggregationKey: ['poi_version', 'boundary_vintage', 'boundary_id'],
  completeness: unavailableLayers.length ? 'partial-explicit' : 'complete-for-declared-layers'
};
await writeFile(path.join(output, 'producer-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Federal Core ${scope}: manifest=${manifest.completeness}.`);
