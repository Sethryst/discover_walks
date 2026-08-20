#!/usr/bin/env node
// Package verified civic envelopes for every Gremlin release without rebuilding
// offline map tiles. This is build-time only; the app reads only these local
// files at runtime.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const releases = 'C:/Users/igmro/OneDrive/Documents/gremlin_lab/releases';
const aliases = { nyc: 'new-york-city', 'prince-georges-county-md': 'prince-georges-county' };
const civicNames = ['vote', 'meetings', 'volunteer', 'organizers', 'events', 'event-sources', 'volunteer-sources'];

for (const entry of await readdir(releases, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sourceDir = path.join(releases, entry.name);
  const manifest = JSON.parse(await readFile(path.join(sourceDir, 'producer-manifest.json'), 'utf8'));
  // Fail closed: every checksum the producer declares must verify before any
  // artifact from this release is accepted into an app-local package.
  for (const [artifact, expectedValue] of Object.entries(manifest.checksums || {})) {
    const actual = createHash('sha256').update(await readFile(path.join(sourceDir, artifact))).digest('hex');
    if (actual !== String(expectedValue).replace(/^sha256:/, '')) throw new Error(`${entry.name}: checksum mismatch for ${artifact}`);
  }
  const civic = {};
  for (const name of civicNames) {
    const file = path.join(sourceDir, 'civic', `${name}.json`);
    try { civic[name] = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const appId = aliases[entry.name] || entry.name;
  const destination = path.join(root, 'regions', appId, 'civic');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'index.json'), JSON.stringify(civic, null, 2));
  console.log(`✓ ${entry.name}: ${Object.keys(civic).join(', ') || 'no civic artifacts'}`);
}
