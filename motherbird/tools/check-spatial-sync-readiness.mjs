#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const regionId = process.argv[2] || 'washington-dc';
const configPath = path.join(root, 'regions', regionId, 'spatial-index.json');
const manifestPath = path.join(root, 'regions', regionId, 'spatial', 'spatial-index-manifest.json');
const [config, manifest] = await Promise.all([readJson(configPath), readJson(manifestPath)]);
const missing = [];
if (!config.syncIdentity?.poiVersion) missing.push('syncIdentity.poiVersion');
if (!config.syncIdentity?.boundaryVintage) missing.push('syncIdentity.boundaryVintage');
if (!manifest.inputs?.poi?.checksum?.startsWith('sha256:')) missing.push('manifest.inputs.poi.checksum');
if (!manifest.indexes?.pois?.recordFingerprint?.startsWith('sha256:')) missing.push('manifest.indexes.pois.recordFingerprint');
if (missing.length) {
  console.error(`${regionId}: NOT READY for persistent county sync; missing ${missing.join(', ')}.`);
  process.exitCode = 2;
} else {
  console.log(`${regionId}: ready to bind durable local operations to ${config.syncIdentity.poiVersion} / ${config.syncIdentity.boundaryVintage}.`);
}

async function readJson(filename) { return JSON.parse(await readFile(filename, 'utf8')); }
