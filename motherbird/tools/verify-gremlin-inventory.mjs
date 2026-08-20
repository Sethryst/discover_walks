#!/usr/bin/env node
// Build-time release gate: validates every checksum declared by every local
// Gremlin Lab producer manifest. It performs no network access and writes no
// runtime artifacts.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const releases = 'C:/Users/igmro/OneDrive/Documents/gremlin_lab/releases';
let verified = 0;
for (const entry of await readdir(releases, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(releases, entry.name);
  const manifest = JSON.parse(await readFile(path.join(directory, 'producer-manifest.json'), 'utf8'));
  for (const [artifact, expectedValue] of Object.entries(manifest.checksums || {})) {
    const actual = createHash('sha256').update(await readFile(path.join(directory, artifact))).digest('hex');
    if (actual !== String(expectedValue).replace(/^sha256:/, '')) throw new Error(`${entry.name}: checksum mismatch for ${artifact}`);
  }
  verified += 1;
}
console.log(`✓ verified every declared checksum in ${verified} Gremlin Lab releases`);
