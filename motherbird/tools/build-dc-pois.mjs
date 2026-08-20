#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DC_SOURCES, NEIGHBORHOOD_SOURCE, SNAPSHOT_DATE } from './dc-pipeline/config.mjs';
import { assignNeighborhoods, deduplicate, normalizeSource, poiStats, validatePois, withinDc } from './dc-pipeline/core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, '.tmp', `dc-pois-${process.pid}`);
const cityOutput = path.join(root, 'data', 'dc-poi.json');
const regionOutput = path.join(root, 'regions', 'washington-dc', 'washington-dc-poi.json');
const reportOutput = path.join(root, 'regions', 'washington-dc', 'dc-poi-build-report.json');
const manifestOutput = path.join(root, 'regions', 'washington-dc', 'manifest.json');

async function readJson(relative) { return JSON.parse(await readFile(path.join(root, relative), 'utf8')); }

try {
  await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true });
  console.log('DC POI build: reading cached official source snapshots');
  const sourceResults = [];
  let pois = [];
  for (const source of DC_SOURCES) {
    const data = await readJson(source.cacheFile);
    if (data.type !== 'FeatureCollection' || (data.features || []).length < source.minRecords) throw new Error(`${source.title}: cached source is incomplete`);
    const normalized = normalizeSource(source, data, SNAPSHOT_DATE); const inBounds = normalized.filter(withinDc);
    sourceResults.push({ id: source.id, title: source.title, records: data.features.length, normalized: inBounds.length, excludedOutsideBoundary: normalized.length - inBounds.length, sourceUrl: source.serviceUrl || source.portalUrl, snapshotAt: SNAPSHOT_DATE });
    pois.push(...inBounds); console.log(`✓ ${source.title}: ${inBounds.length}${normalized.length !== inBounds.length ? ` (${normalized.length - inBounds.length} outside DC excluded)` : ''}`);
  }
  const clusters = await readJson(NEIGHBORHOOD_SOURCE.cacheFile);
  pois = assignNeighborhoods(pois, clusters);
  console.log(`✓ Neighborhood assignment: ${clusters.features.length} cluster polygons`);
  const deduped = deduplicate(pois); pois = deduped.pois;
  console.log(`✓ Deduplication: ${deduped.report.merged} merged; ${deduped.report.kept} kept`);
  const checked = validatePois(pois);
  if (checked.invalid.length) throw new Error(`Validation failed for ${checked.invalid.length} POIs:\n${JSON.stringify(checked.invalid.slice(0, 20), null, 2)}`);
  const metadata = { version: 'dc-poi-v1', generatedFromSnapshot: SNAPSHOT_DATE, attribution: 'Open Data DC', count: pois.length, sourceUrl: 'https://opendata.dc.gov/' };
  const city = { metadata, trailSegments: [], pointsOfInterest: checked.valid };
  const region = { pois: checked.valid };
  const report = { schemaVersion: 1, generatedFromSnapshot: SNAPSHOT_DATE, sources: sourceResults, neighborhoodSource: { ...NEIGHBORHOOD_SOURCE, queryUrl: undefined }, deduplication: deduped.report, stats: poiStats(checked.valid) };
  const manifest = JSON.parse(await readFile(manifestOutput, 'utf8')); manifest.stats = { ...(manifest.stats || {}), poiCount: checked.valid.length };
  const stagedCity = path.join(staging, 'dc-poi.json'); const stagedRegion = path.join(staging, 'washington-dc-poi.json'); const stagedReport = path.join(staging, 'dc-poi-build-report.json'); const stagedManifest = path.join(staging, 'manifest.json');
  await Promise.all([writeFile(stagedCity, `${JSON.stringify(city, null, 2)}\n`), writeFile(stagedRegion, `${JSON.stringify(region, null, 2)}\n`), writeFile(stagedReport, `${JSON.stringify(report, null, 2)}\n`), writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`)]);
  await Promise.all([rm(cityOutput, { force: true }), rm(regionOutput, { force: true }), rm(reportOutput, { force: true }), rm(manifestOutput, { force: true })]);
  await Promise.all([rename(stagedCity, cityOutput), rename(stagedRegion, regionOutput), rename(stagedReport, reportOutput), rename(stagedManifest, manifestOutput)]);
  console.log(`✓ Validated ${checked.valid.length} POIs`); console.log(`✓ Wrote ${path.relative(root, cityOutput)} and ${path.relative(root, regionOutput)}`); console.log('✓ DC POI pipeline complete');
} finally { await rm(staging, { recursive: true, force: true }); }
