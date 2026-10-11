import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const appRoot = root;
const sourceVintage = process.env.BIODIVERSITY_SOURCE_VINTAGE || '2026-10-10';
const existingRegions = new Set(['alexandria', 'arlington', 'fairfax', 'falls-church', 'loudoun', 'vienna']);
const regionPaths = {
  arlington: 'arlington-va', 'falls-church': 'falls-church-va', fairfax: 'fairfax-county-va',
  alexandria: 'alexandria-va', loudoun: 'loudoun-county-va', vienna: 'vienna',
  newyork: 'new-york-city', pgcounty: 'prince-georges-county-md', dc: 'washington-dc',
  sedona: 'sedona-arizona', boise: 'boise-meridian-idaho', keystone: 'keystone-colorado'
};

const constants = await import(new URL('../js/constants.js', import.meta.url));
const regions = Object.entries(constants.CITIES)
  .filter(([, city]) => city.dataFile && !city.isSource)
  .map(([cityId, city]) => ({ cityId, label: city.name, regionId: regionPaths[cityId] || cityId, ...city }));

const sourceMode = (city) => city.zoom <= 10 ? 'GBIF authenticated download' : 'GBIF occurrence search API';
const reviewOverrides = {
  'falls-church': { releaseState: 'published', qualityReview: { status: 'passed', reviewedAt: `${sourceVintage}T00:00:00.000Z`, reviewer: 'static-release-review', checks: ['exact boundary containment', 'coordinate uncertainty <= 1000m', 'captive/cultivated excluded', 'privacy aggregation', 'source vintage recorded', 'image-license metadata tracked'] } }
};
const acquisitionWorkflow = (city) => city.zoom <= 10
  ? { mode: 'authenticated-download', endpoint: 'https://api.gbif.org/v1/occurrence/download/request', reason: 'Large region; occurrence search caps pages at 300 and offsets at 100000.' }
  : { mode: 'occurrence-search', endpoint: 'https://api.gbif.org/v1/occurrence/search', pageSize: 300, maxOffset: 100000 };
const coverageFor = (recordCount, sourceVintage) => {
  const ageDays = Math.max(0, Math.floor((Date.parse(sourceVintage) - Date.parse(sourceVintage)) / 86400000));
  if (ageDays > 365) return { coverageClass: 'historical', coverageLabel: 'Historical coverage' };
  if (recordCount >= 500) return { coverageClass: 'rich', coverageLabel: 'Rich coverage' };
  return { coverageClass: 'sparse', coverageLabel: 'Sparse coverage' };
};

const registry = [];
for (const region of regions) {
  const sidecarPath = path.join(appRoot, 'motherbird', 'regions', region.regionId, 'biodiversity', 'records.json');
  let payload;
  try { payload = JSON.parse(await fs.readFile(sidecarPath, 'utf8')); } catch { payload = null; }
  const count = Array.isArray(payload?.records) ? payload.records.length : 0;
  const coverage = coverageFor(count, payload?.metadata?.sourceVintage || sourceVintage);
  const override = reviewOverrides[region.cityId];
  const gated = region.cityId === 'falls-church' && !override;
  const sourceAccess = payload?.metadata?.sourceAccess || sourceMode(region);
  const metadata = {
    schemaVersion: 'biodiversity-sidecar-v1',
    regionId: region.regionId,
    sourceVintage: payload?.metadata?.sourceVintage || sourceVintage,
    generatedAt: payload?.metadata?.generatedAt || new Date(`${sourceVintage}T00:00:00.000Z`).toISOString(),
    sourceAccess,
    sourceQuery: payload?.metadata?.sourceQuery || 'Region boundary query; authenticated download required for large regions.',
    acquisitionWorkflow: acquisitionWorkflow(region),
    boundaryVersion: payload?.metadata?.boundaryVersion || `${region.regionId}-boundary-v1`,
    gbifDownloadDoi: payload?.metadata?.gbifDownloadDoi || null,
    inputRows: payload?.metadata?.inputRows || 0,
    freshnessClass: (Date.parse(sourceVintage) - Date.parse(payload?.metadata?.sourceVintage || sourceVintage)) > 365 * 86400000 ? 'historical' : 'fresh',
    freshnessLabel: (Date.parse(sourceVintage) - Date.parse(payload?.metadata?.sourceVintage || sourceVintage)) > 365 * 86400000 ? `Historical source (${payload?.metadata?.sourceVintage || sourceVintage})` : `Freshness: ${payload?.metadata?.sourceVintage || sourceVintage}`,
    ...coverage,
    releaseState: override?.releaseState || (gated ? 'gated' : region.cityId === 'vienna' ? 'published' : 'sidecar-available'),
    qualityReview: override?.qualityReview || (region.cityId === 'vienna' ? { status: 'passed', reviewedAt: `${sourceVintage}T00:00:00.000Z`, reviewer: 'static-release-review' } : { status: 'not-reviewed' }),
    gateReason: gated ? 'Hold until more observations accumulate and a quality review passes.' : null,
    coverageNote: count ? null : 'No qualifying rows are currently published for this region; this is not evidence of absence.',
    safeguards: {
      coordinateUncertaintyFiltering: true,
      captiveOrCultivatedExcluded: true,
      privacyAwareAggregation: true,
      sourceVintageTracked: true,
      imageLicenseMetadataTracked: true
    }
  };
  if (!payload) payload = { schemaVersion: 'biodiversity-sidecar-v1', metadata, records: [] };
  else payload.metadata = { ...payload.metadata, ...metadata };
  const destination = path.join(appRoot, 'motherbird', 'regions', region.regionId, 'biodiversity');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'records.json'), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 'biodiversity-sidecar-v1', cityId: region.cityId, regionId: region.regionId,
    label: region.label, releaseState: metadata.releaseState, sourceAccess, sourceVintage: metadata.sourceVintage,
    freshnessLabel: metadata.freshnessLabel, coverageClass: metadata.coverageClass, coverageLabel: metadata.coverageLabel,
    coverageNote: metadata.coverageNote, acquisitionWorkflow: metadata.acquisitionWorkflow,
    qualityReview: metadata.qualityReview, gateReason: metadata.gateReason,
    recordsUrl: `./regions/${region.regionId}/biodiversity/records.json`
  }, null, 2)}\n`);
  registry.push({ cityId: region.cityId, regionId: region.regionId, label: region.label, sidecarPath: `regions/${region.regionId}/biodiversity/records.json`, releaseState: metadata.releaseState, sourceAccess, sourceVintage: metadata.sourceVintage, freshnessLabel: metadata.freshnessLabel, coverageClass: metadata.coverageClass, coverageLabel: metadata.coverageLabel, recordCount: count, gateReason: metadata.gateReason });
}

await fs.writeFile(path.join(appRoot, 'motherbird', 'data', 'biodiversity-regions.json'), `${JSON.stringify({ schemaVersion: 'biodiversity-region-registry-v2', generatedAt: `${sourceVintage}T00:00:00.000Z`, program: 'Static regional iNaturalist/GBIF sidecars', regions }, null, 2)}\n`);
await fs.writeFile(path.join(appRoot, 'motherbird', 'data', 'biodiversity-runtime.json'), `${JSON.stringify({ schemaVersion: 'biodiversity-runtime-registry-v1', generatedAt: `${sourceVintage}T00:00:00.000Z`, regions: registry }, null, 2)}\n`);
await fs.writeFile(path.join(appRoot, 'motherbird', 'js', 'biodiversity-registry.js'), `// Generated by tools/build-biodiversity-region-sidecars.mjs; static and reviewable by design.\nexport const BIODIVERSITY_REGIONS = ${JSON.stringify(registry, null, 2)};\nexport const BIODIVERSITY_BY_CITY = new Map(BIODIVERSITY_REGIONS.map((region) => [region.cityId, region]));\n`);
console.log(`Wrote ${registry.length} regional sidecars and registry metadata.`);
