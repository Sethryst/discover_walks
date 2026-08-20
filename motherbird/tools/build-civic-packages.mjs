#!/usr/bin/env node
// Package verified civic envelopes for every Gremlin release without rebuilding
// offline map tiles. This is build-time only; the app reads only these local
// files at runtime.
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
};
const releases = option('--releases', path.join(workspaceRoot, 'releases'));
const output = option('--output', path.join(appRoot, 'regions'));
const aliases = { nyc: 'new-york-city', 'prince-georges-county-md': 'prince-georges-county', 'wolf-trap-va': 'vienna' };
const civicNames = ['vote', 'meetings', 'volunteer', 'organizers', 'events', 'event-sources', 'volunteer-sources'];
const packaged = [];

await access(releases, constants.R_OK);
for (const entry of await readdir(releases, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sourceDir = path.join(releases, entry.name);
  const manifestPath = path.join(sourceDir, 'producer-manifest.json');
  try { await access(manifestPath, constants.R_OK); } catch { continue; }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.regionId !== entry.name) throw new Error(`${entry.name}: manifest regionId does not match its release directory`);
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
  if (!Object.keys(civic).length) continue;
  const appId = aliases[entry.name] || entry.name;
  const destination = path.join(output, appId, 'civic');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'index.json'), JSON.stringify({ schemaVersion: 1, regionId: manifest.regionId, generatedAt: manifest.generatedAt, artifacts: civic }, null, 2) + '\n');
  packaged.push({ appId, regionId: manifest.regionId, artifacts: Object.keys(civic) });
  console.log(`✓ ${entry.name}: ${Object.keys(civic).join(', ') || 'no civic artifacts'}`);
}

if (!packaged.length) throw new Error(`No verified civic artifacts found in ${releases}`);
console.log(`Packaged ${packaged.length} verified civic regions into ${output}`);
