#!/usr/bin/env node
// Copy a checksum-verified producer POI artifact into the static app. This is
// an explicit release-to-runtime handoff; the browser never reads /releases.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const regionId = process.argv[2];
if (!regionId || regionId.startsWith('-')) throw new Error('Usage: node tools/sync-gremlin-pois.mjs <region-id> [releases-dir]');
const appRoot = path.resolve(import.meta.dirname, '..');
const releases = path.resolve(process.argv[3] || path.join(appRoot, '..', 'releases'));
const bundle = path.join(releases, regionId);
const manifest = JSON.parse(await readFile(path.join(bundle, 'producer-manifest.json'), 'utf8'));
if (manifest.regionId !== regionId) throw new Error(`Producer manifest region mismatch for ${regionId}`);
const source = path.join(bundle, 'pois.json');
const actual = `sha256:${createHash('sha256').update(await readFile(source)).digest('hex')}`;
if (manifest.checksums?.['pois.json'] !== actual) throw new Error(`${regionId}: producer checksum mismatch for pois.json`);
const destination = path.join(appRoot, 'regions', regionId);
await mkdir(destination, { recursive: true });
await copyFile(source, path.join(destination, 'pois.json'));
console.log(`Synced ${regionId} POIs (${actual}).`);
