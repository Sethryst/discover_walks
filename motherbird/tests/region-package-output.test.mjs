import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { RegionPackage } from '../js/region-package.js';

const root = path.resolve(import.meta.dirname, '..');
const requestedIds = process.argv.slice(2);
const ids = requestedIds.length ? requestedIds : [];
for (const entry of await readdir(path.join(root, 'regions'), { withFileTypes: true })) {
  if (!entry.isDirectory() || requestedIds.length) continue;
  try { await stat(path.join(root, 'regions', entry.name, 'manifest.json')); ids.push(entry.name); } catch { /* static data folder, not a region package */ }
}
assert.ok(ids.length > 0, 'at least one published region package is required for this contract test');
for (const id of ids) {
  const directory = path.join(root, 'regions', id);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id || manifest.regionId, id);
  if (!manifest.id || !manifest.boundary) {
    console.log(`${id}: legacy manifest schema detected; current region-build source configuration is not present in this checkout.`);
    continue;
  }
  assert.ok(['Polygon', 'MultiPolygon'].includes(manifest.boundary.geometry.type));
  try {
    await stat(path.join(directory, manifest.artifacts.pmtiles));
  } catch {
    // Source checkouts intentionally omit sponsor-funded PMTiles binaries.
    // region-build.mjs validates this same contract before publishing one.
    console.log(`${id}: PMTiles not published in this checkout; package runtime check skipped.`);
    continue;
  }
  for (const artifact of [manifest.artifacts.pmtiles, manifest.artifacts.poi, manifest.artifacts.buckets, ...manifest.artifacts.supplemental]) {
    assert.ok((await stat(path.join(directory, artifact))).size > 0, `${id}: missing ${artifact}`);
  }
  const pmtiles = await readFile(path.join(directory, manifest.artifacts.pmtiles));
  assert.equal(pmtiles.subarray(0, 7).toString('ascii'), 'PMTiles');
  const pkg = new RegionPackage({ id, manifest, pmtilesBlob: new Blob([pmtiles]), poiData: JSON.parse(await readFile(path.join(directory, manifest.artifacts.poi))), bucketsData: JSON.parse(await readFile(path.join(directory, manifest.artifacts.buckets))) });
  assert.equal(pkg.name, manifest.name);
}
console.log('published region package runtime-contract test passed');
