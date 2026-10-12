import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const motherbirdRoot = path.resolve(toolDirectory, '..');
const repoRoot = path.resolve(motherbirdRoot, '..');

const CITY_REGION_IDS = {
  arlington: 'arlington-va', 'falls-church': 'falls-church-va', norfolk: 'norfolk', newyork: 'nyc', philadelphia: 'philadelphia',
  richmond: 'richmond', keystone: 'keystone-colorado', pgcounty: 'prince-georges-county-md', fairfax: 'fairfax-county-va',
  alexandria: 'alexandria-va', loudoun: 'loudoun-county-va', dc: 'washington-dc', sedona: 'sedona-arizona', boise: 'boise-meridian-idaho'
};

const CAPABILITY_DEFINITIONS = {
  places: { label: 'Places and points of interest', delivery: 'offline', domains: [] },
  journeys: { label: 'Curated journeys', delivery: 'offline', domains: ['journey'] },
  walkingNetwork: { label: 'Walking network and trail context', delivery: 'offline', domains: ['trails', 'trail'] },
  civic: { label: 'Civic information and events', delivery: 'offline', domains: ['event', 'events', 'meetings', 'volunteer'] },
  wildlife: { label: 'Wildlife and biodiversity', delivery: 'offline', domains: ['wildlife', 'biodiversity'] },
  boundaries: { label: 'Geographic boundaries', delivery: 'offline', domains: ['boundary'] },
  learn: { label: 'Stories and learning context', delivery: 'offline', domains: ['history', 'learn'] },
  weather: { label: 'Weather and daylight context', delivery: 'live', domains: ['weather'] }
};

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function exists(file) {
  try { await access(file, constants.R_OK); return true; } catch { return false; }
}

function regionIdFor(cityId, city) {
  return CITY_REGION_IDS[cityId] || city.dataFile?.match(/regions\/([^/]+)\//)?.[1] || cityId;
}

function absoluteRuntimePath(runtimePath) {
  return path.resolve(motherbirdRoot, String(runtimePath || '').replace(/^\.\//, ''));
}

function packageRoot(regionId) {
  return path.resolve(motherbirdRoot, 'regions', regionId);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countRecords(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  const direct = ['pois', 'pointsOfInterest', 'features', 'journeys', 'items', 'records'].reduce((sum, key) => sum + (Array.isArray(payload[key]) ? payload[key].length : 0), 0);
  const nested = payload.artifacts && typeof payload.artifacts === 'object'
    ? Object.values(payload.artifacts).reduce((sum, artifact) => sum + countRecords(artifact), 0)
    : 0;
  return direct + nested;
}

function sourceRecords(regionConfig, producerManifest, osmManifest, biodiversityManifest) {
  const configured = (regionConfig?.sources || []).map((source) => ({
    id: source.id, name: source.name, provider: source.provider, url: source.url,
    attribution: source.attribution, licenseUrl: source.licenseUrl, domains: source.domains || [], status: source.status || 'configured'
  }));
  const producer = (producerManifest?.sources || []).map((source) => ({
    id: source.id, name: source.name, provider: source.provider, url: source.url,
    attribution: source.attribution, licenseUrl: source.licenseUrl, domains: source.domains || [], status: source.acquireStatus || source.status || 'unknown'
  }));
  const osm = osmManifest?.source ? [{
    id: osmManifest.sourceConfigurationId || 'osm', name: osmManifest.source.name || 'OpenStreetMap', provider: 'osm_overpass',
    url: osmManifest.source.url, attribution: osmManifest.source.attribution, licenseUrl: osmManifest.source.licenseUrl || osmManifest.source.license, domains: osmManifest.recordCountsByCategory ? Object.keys(osmManifest.recordCountsByCategory) : [],
    status: 'published'
  }] : [];
  const biodiversity = biodiversityManifest?.sourceAccess ? [{
    id: `${biodiversityManifest.regionId || 'region'}-biodiversity`, name: biodiversityManifest.sourceAccess, provider: 'biodiversity',
    url: biodiversityManifest.acquisitionWorkflow?.endpoint, attribution: null, licenseUrl: null, domains: ['wildlife', 'biodiversity'], status: biodiversityManifest.releaseState || 'unknown'
  }] : [];
  return [...configured, ...producer, ...osm, ...biodiversity];
}

function sourceEvidence(sources, domains = []) {
  const selected = domains.length
    ? sources.filter((source) => domains.some((domain) => [...(source.domains || []), source.name, source.id, source.provider].filter(Boolean).join(' ').toLowerCase().includes(domain)))
    : sources;
  return {
    sources: selected.map(({ id, name, provider, url, attribution, licenseUrl, status }) => ({ id, name, provider, url, status })),
    attribution: unique(selected.map((source) => source.attribution)),
    licenseUrls: unique(selected.map((source) => source.licenseUrl))
  };
}

function validationEvidence(producerManifest, osmManifest, biodiversityManifest, hasArtifact) {
  const statuses = [];
  if (producerManifest?.validation) statuses.push(producerManifest.validation.valid === true ? 'valid' : 'invalid');
  if (osmManifest?.validation) statuses.push(osmManifest.validation.valid === true ? 'valid' : 'review');
  if (biodiversityManifest?.qualityReview?.status) statuses.push(biodiversityManifest.qualityReview.status);
  if (!statuses.length) statuses.push(hasArtifact ? 'artifact-present' : 'not-evaluated');
  return unique(statuses);
}

async function capabilityFor({ key, definition, artifactPaths, payloads, sources, producerManifest, osmManifest, biodiversityManifest, region }) {
  const artifacts = artifactPaths.filter(Boolean);
  const present = artifacts.length > 0;
  const records = payloads.reduce((sum, payload) => sum + countRecords(payload), 0);
  const status = definition.delivery === 'live' ? 'available' : present && records > 0 ? 'furnished' : present ? 'declared-empty' : 'unavailable';
  const evidence = sourceEvidence(sources, definition.domains);
  const generatedAt = unique([
    producerManifest?.generatedAt, osmManifest?.generatedAt, biodiversityManifest?.sourceVintage,
    ...payloads.map((payload) => payload?.generatedAt || payload?.metadata?.generatedAt)
  ]).sort().at(-1) || null;
  const sourceVintage = unique([osmManifest?.sourceVintage, biodiversityManifest?.sourceVintage, ...sources.map((source) => source.acquiredAt)]).sort().at(-1) || null;
  return {
    id: key, label: definition.label, status, delivery: definition.delivery, offline: definition.delivery === 'offline' && status === 'furnished',
    artifacts, recordCount: records, freshness: { generatedAt, sourceVintage, policy: definition.delivery === 'live' ? 'on-request' : 'package-vintage' },
    provenance: evidence.sources, attribution: evidence.attribution, licenseUrls: evidence.licenseUrls,
    validation: { status: validationEvidence(producerManifest, osmManifest, biodiversityManifest, present) },
    coverage: { bbox: region.bbox || null, geometryTypes: unique(payloads.flatMap((payload) => payload?.geometryTypes || [])), recordCount: records },
    dependencies: key === 'journeys' ? ['places', 'walkingNetwork'] : key === 'walkingNetwork' ? ['places'] : []
  };
}

export async function buildRegionalCapabilities(outputPath = path.resolve(motherbirdRoot, 'data', 'regional-capabilities.json')) {
  const regions = {};
  for (const [cityId, city] of Object.entries(CITIES)) {
    const regionId = regionIdFor(cityId, city);
    const root = packageRoot(regionId);
    const producerManifest = await readJson(path.resolve(root, 'producer-manifest.json'));
    const osmManifest = await readJson(path.resolve(root, 'osm', 'manifest.json'));
    const biodiversityManifest = await readJson(path.resolve(root, 'biodiversity', 'manifest.json'));
    const regionConfig = await readJson(path.resolve(repoRoot, 'app', 'regions', `${regionId}.json`), {});
    const primaryPath = city.dataFile ? absoluteRuntimePath(city.dataFile) : null;
    const primaryPayload = primaryPath ? await readJson(primaryPath) : null;
    const supplemental = await Promise.all((city.supplementalPoiFiles || []).concat(city.supplementalPoiFile || []).filter(Boolean).map((file) => readJson(absoluteRuntimePath(file))));
    const civicPayload = city.civicFile ? await readJson(absoluteRuntimePath(city.civicFile)) : null;
    const journeyPayload = city.journeyFile ? await readJson(absoluteRuntimePath(city.journeyFile)) : null;
    const learnPayload = city.learnFile ? await readJson(absoluteRuntimePath(city.learnFile)) : null;
    const sources = sourceRecords(regionConfig, producerManifest, osmManifest, biodiversityManifest);
    const artifact = (file) => file && path.relative(motherbirdRoot, absoluteRuntimePath(file)).replaceAll('\\', '/');
    const capabilities = {};
    capabilities.places = await capabilityFor({ key: 'places', definition: CAPABILITY_DEFINITIONS.places, artifactPaths: [artifact(city.dataFile), ...((city.supplementalPoiFiles || []).concat(city.supplementalPoiFile || []).map(artifact))], payloads: [primaryPayload, ...supplemental], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.journeys = await capabilityFor({ key: 'journeys', definition: CAPABILITY_DEFINITIONS.journeys, artifactPaths: [artifact(city.journeyFile)], payloads: [journeyPayload], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.walkingNetwork = await capabilityFor({ key: 'walkingNetwork', definition: CAPABILITY_DEFINITIONS.walkingNetwork, artifactPaths: [artifact(city.edgeFile), osmManifest ? `regions/${regionId}/osm/manifest.json` : null], payloads: [await readJson(path.resolve(root, 'edges.json')), await readJson(path.resolve(root, 'osm', 'pois.json'))], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.civic = await capabilityFor({ key: 'civic', definition: CAPABILITY_DEFINITIONS.civic, artifactPaths: [artifact(city.civicFile)], payloads: [civicPayload], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.wildlife = await capabilityFor({ key: 'wildlife', definition: CAPABILITY_DEFINITIONS.wildlife, artifactPaths: [biodiversityManifest ? `regions/${regionId}/biodiversity/manifest.json` : null], payloads: [await readJson(path.resolve(root, 'biodiversity', 'records.json'))], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.boundaries = await capabilityFor({ key: 'boundaries', definition: CAPABILITY_DEFINITIONS.boundaries, artifactPaths: [city.boundarySource ? 'configured-boundary-source' : null, await exists(path.resolve(root, 'geography', 'boundary.geojson')) ? `regions/${regionId}/geography/boundary.geojson` : null], payloads: [await readJson(path.resolve(root, 'geography', 'boundary.geojson'))], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.learn = await capabilityFor({ key: 'learn', definition: CAPABILITY_DEFINITIONS.learn, artifactPaths: [artifact(city.learnFile)], payloads: [learnPayload], sources, producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    capabilities.weather = await capabilityFor({ key: 'weather', definition: CAPABILITY_DEFINITIONS.weather, artifactPaths: ['runtime:NWS', 'runtime:Open-Meteo', 'runtime:Sunrise-Sunset'], payloads: [], sources: [{ id: 'nws', name: 'National Weather Service', provider: 'nws', url: 'https://api.weather.gov/', attribution: null, licenseUrl: 'https://www.weather.gov/documentation/services-web-api' }, { id: 'open-meteo', name: 'Open-Meteo', provider: 'open_meteo', url: 'https://api.open-meteo.com/', attribution: null, licenseUrl: null }], producerManifest, osmManifest, biodiversityManifest, region: regionConfig });
    regions[regionId] = { regionId, cityId, name: city.name, state: city.state, center: city.center, bbox: regionConfig.bbox || null, capabilities };
  }
  const manifest = { schemaVersion: 2, manifestType: 'regional-capabilities', generatedAt: new Date().toISOString(), publication: { state: 'static', boundary: 'validated package evidence only', discoveryPolicy: 'Discover → Review → Approve → Publish' }, regions };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildRegionalCapabilities();
  console.log(`Built regional capabilities manifest: ${Object.keys(manifest.regions).length} regions.`);
}
