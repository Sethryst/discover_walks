import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const shouldFetch = !process.argv.includes('--skip-fetch');

function run(script, args = []) {
  execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
}

if (shouldFetch) run('tools/fetch-biodiversity-app-regions.mjs');
run('tools/build-biodiversity-region-sidecars.mjs');

const runtime = JSON.parse(await fs.readFile(path.join(root, 'data/biodiversity-runtime.json'), 'utf8'));
const supportedCities = Object.entries(CITIES).filter(([, city]) => city.dataFile);
if (runtime.regions.length !== supportedCities.length) {
  throw new Error(`Regional registry mismatch: ${runtime.regions.length} generated for ${supportedCities.length} supported regions`);
}

let totalRecords = 0;
const coverage = new Map();
for (const region of runtime.regions) {
  if (!region.freshnessLabel || !region.coverageLabel || !region.sourceAccess) throw new Error(`Missing coverage metadata for ${region.cityId}`);
  const manifestPath = path.join(root, 'regions', region.regionId, 'biodiversity/manifest.json');
  const recordsPath = path.join(root, 'regions', region.regionId, 'biodiversity/records.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const payload = JSON.parse(await fs.readFile(recordsPath, 'utf8'));
  if (!Array.isArray(payload.records) || region.recordCount !== payload.records.length) throw new Error(`Record count mismatch for ${region.cityId}`);
  for (const record of payload.records) {
    if (!record.coordinateUncertainty || !record.source || record.source.captiveOrCultivatedExcluded !== true) throw new Error(`Safeguard metadata missing for ${region.cityId}/${record.recordId}`);
    if (!Object.hasOwn(record, 'representativeImage')) throw new Error(`Image-license field missing for ${region.cityId}/${record.recordId}`);
    if ('latitude' in record || 'longitude' in record) throw new Error(`Exact coordinates leaked for ${region.cityId}/${record.recordId}`);
  }
  totalRecords += payload.records.length;
  coverage.set(manifest.coverageClass, (coverage.get(manifest.coverageClass) || 0) + 1);
}

console.log(JSON.stringify({ regions: runtime.regions.length, records: totalRecords, coverage: Object.fromEntries(coverage), fetched: shouldFetch }, null, 2));
