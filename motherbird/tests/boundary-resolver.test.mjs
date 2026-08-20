import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveBoundary } from '../tools/boundary-resolver.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'region-boundary-'));
const geometry = { type: 'Polygon', coordinates: [[[1, 2], [3, 2], [3, 4], [1, 2]]] };
await writeFile(path.join(root, 'cached.geojson'), JSON.stringify({ type: 'Feature', geometry }));
for (const boundary of [
  { source: 'explicit', geometry },
  { source: 'cache-file', file: 'cached.geojson' },
  { source: 'authoritative-geojson', url: 'data:application/json,' + encodeURIComponent(JSON.stringify({ type: 'Feature', geometry })), cacheFile: 'authoritative.geojson' }
]) {
  const result = await resolveBoundary(boundary, { root, cacheDir: path.join(root, 'out') });
  assert.deepEqual(result.bbox, { west: 1, south: 2, east: 3, north: 4 });
}
console.log('boundary resolver test passed');
