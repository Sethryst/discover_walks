#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DC_SOURCES, NEIGHBORHOOD_SOURCE } from '../dc-pipeline/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verifyOnly = process.argv.includes('--verify-only');
const sources = [...DC_SOURCES, NEIGHBORHOOD_SOURCE];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Walk-Wildlife-DC-POI-Builder/1.0' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

for (const source of sources) {
  const cachePath = path.join(root, source.cacheFile);
  if (source.cacheOnly) {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    if (cached.type !== 'FeatureCollection' || (cached.features || []).length < source.minRecords) throw new Error(`${source.title}: cached snapshot is missing or incomplete`);
    console.log(`✓ ${source.title}: cached official snapshot (${cached.features.length} records)`);
    continue;
  }
  const metadata = await fetchJson(`${source.serviceUrl}?f=json`);
  if (metadata.error || !metadata.name) throw new Error(`${source.title}: ArcGIS metadata is invalid`);
  if (verifyOnly) { console.log(`✓ ${source.title}: source available (${metadata.name})`); continue; }
  const geojson = await fetchJson(source.queryUrl);
  if (geojson.type !== 'FeatureCollection' || (geojson.features || []).length < source.minRecords) throw new Error(`${source.title}: expected at least ${source.minRecords} records`);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(geojson)}\n`);
  console.log(`✓ ${source.title}: refreshed ${geojson.features.length} records`);
}
console.log(verifyOnly ? '✓ All DC POI sources are available.' : '✓ DC source snapshots refreshed.');

