#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const regionId = process.argv[2];
if (!regionId || regionId.startsWith('-')) throw new Error('Usage: node tools/sync-gremlin-journeys.mjs <region-id> [releases-dir]');
const appRoot = path.resolve(import.meta.dirname, '..');
const releases = path.resolve(process.argv[3] || path.join(appRoot, '..', 'releases'));
const bundle = path.join(releases, regionId);
const manifest = JSON.parse(await readFile(path.join(bundle, 'producer-manifest.json'), 'utf8'));
const relative = 'supplemental/journeys.json';
const source = path.join(bundle, ...relative.split('/'));
const payload = await readFile(source);
const actual = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
if (manifest.regionId !== regionId || manifest.checksums?.[relative] !== actual) throw new Error(`${regionId}: journey producer checksum mismatch`);
const destination = path.join(appRoot, 'regions', regionId);
await mkdir(destination, { recursive: true });
await copyFile(source, path.join(destination, 'journeys.json'));
console.log(`Synced ${regionId} journeys (${actual}).`);
