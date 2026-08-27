#!/usr/bin/env node
/** Publish verified backend POI releases for regions not yet exposed in the frontend. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(root, '..');
const regions = ['asheville', 'boston', 'boulder', 'chicago', 'denver', 'new-orleans', 'portland', 'portland-maine', 'san-francisco', 'santa-fe', 'wolf-trap-va'];

for (const regionId of regions) {
  const releaseRoot = path.join(projectRoot, 'releases', regionId);
  const manifest = JSON.parse(await readFile(path.join(releaseRoot, 'producer-manifest.json'), 'utf8'));
  const poisBytes = await readFile(path.join(releaseRoot, 'pois.json'));
  const expected = manifest.checksums?.['pois.json'];
  const actual = `sha256:${createHash('sha256').update(poisBytes).digest('hex')}`;
  if (!expected || expected !== actual) throw new Error(`${regionId}: producer manifest does not verify pois.json`);
  const release = JSON.parse(poisBytes);
  if (!Array.isArray(release.pois) || release.pois.some((poi) => !poi.id || !poi.name || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng))) throw new Error(`${regionId}: invalid runtime POI contract`);
  const output = path.join(root, 'regions', regionId);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'pois.json'), poisBytes);
  await writeFile(path.join(output, 'poi-source.json'), `${JSON.stringify({ schemaVersion: 1, regionId, generatedAt: release.generatedAt, producer: release.producer, sourceRelease: `releases/${regionId}/pois.json`, checksum: actual }, null, 2)}\n`);
  console.log(`${regionId}: published ${release.pois.length} verified POIs`);
}
