import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';
import { DISCOVER_GROUPS, discoverGroupFor, publishingState } from '../js/discovery-taxonomy.js';

const here = dirname(fileURLToPath(import.meta.url));
const motherbirdRoot = resolve(here, '..');
const repoRoot = resolve(motherbirdRoot, '..');

const CITY_REGION_IDS = {
  arlington: 'arlington-va', 'falls-church': 'falls-church-va', norfolk: 'norfolk', newyork: 'nyc', philadelphia: 'philadelphia',
  richmond: 'richmond', keystone: 'keystone-colorado', pgcounty: 'prince-georges-county-md',
  fairfax: 'fairfax-county-va', alexandria: 'alexandria-va', loudoun: 'loudoun-county-va',
  dc: 'washington-dc', sedona: 'sedona-arizona', boise: 'boise-meridian-idaho'
};

const FRONTEND_PATHS = {
  event: 'Explore → Events', events: 'Explore → Events', meetings: 'Vote → Meetings',
  volunteer: 'Volunteer', vote: 'Vote', wildlife: 'Map → Wildlife', water: 'Map → Water',
  trails: 'Map + Walk ideas', route: 'Walk ideas', parks: 'Map → Parks', facilities: 'Map amenities',
  accessibility: 'Map + route details', history: 'Map → History', art: 'Map → Art',
  nature: 'Map → Nature', coffee: 'Map → Coffee', community: 'Map → Community',
  plant: 'Map → Nature', rest: 'Map amenities', scenic: 'Walk ideas'
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

function appPath(relativePath) {
  return resolve(motherbirdRoot, String(relativePath || '').replace(/^\.\//, ''));
}

function countPoiRecords(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  return ['pointsOfInterest', 'pois', 'features'].reduce((count, key) => count + (Array.isArray(payload[key]) ? payload[key].length : 0), 0);
}

function poiRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ['pointsOfInterest', 'pois', 'features']) if (Array.isArray(payload[key])) return payload[key];
  return [];
}

function authorityFamily(poi) {
  const sourceValues = Array.isArray(poi.source) ? poi.source : [poi.source];
  const source = sourceValues.map((item) => typeof item === 'string' ? item : `${item?.name || ''} ${item?.url || ''}`).join(' ').toLowerCase();
  const tags = Array.isArray(poi.tags) ? poi.tags : [];
  if (tags.includes('osm') || /openstreetmap|osm\.org/.test(source)) return 'Open/community';
  if (/\.gov\b|\.mil\b|nps\.gov|usgs\.gov|si\.edu|cornell\.edu/.test(source)) return 'Government/institutional';
  return 'Unclassified/other';
}

const ENRICHMENT_FIELDS = [
  ['description', 'Description or story'], ['source', 'Source provenance'], ['website', 'Official link'],
  ['hours', 'Hours'], ['accessibility', 'Accessibility'], ['amenities', 'Amenities'],
  ['review', 'Review evidence'], ['publishingState', 'Explicit publishing state'], ['discoverCategory', 'Explicit Discover category']
];

function meaningful(value) {
  if (value == null || value === '' || value === 'N/A') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(meaningful);
  if (typeof value === 'boolean') return value;
  return true;
}

export function poiMetadataKpi(poi) {
  const values = {
    description: poi.description || poi.story || poi.context || poi.historyText,
    source: poi.source,
    website: poi.website || poi.link || poi.officialUrl,
    hours: poi.hours || poi.openingHours,
    accessibility: poi.accessibility || poi.wheelchair,
    amenities: poi.amenities || [poi.restrooms && 'restrooms', poi.parking && 'parking', poi.drinkingWater && 'drinking water'].filter(Boolean),
    review: poi.review?.validationStatus || poi.editorial_status,
    publishingState: poi.publishingState,
    discoverCategory: poi.discoverCategory
  };
  const present = ENRICHMENT_FIELDS.filter(([key]) => meaningful(values[key])).map(([key]) => key);
  const missing = ENRICHMENT_FIELDS.filter(([key]) => !meaningful(values[key])).map(([key]) => key);
  return { present, missing, completeness: Math.round(present.length / ENRICHMENT_FIELDS.length * 100) };
}

function summarizeMetadata(records) {
  const missing = Object.fromEntries(ENRICHMENT_FIELDS.map(([key, label]) => [key, { key, label, count: 0 }]));
  let totalScore = 0;
  let narrativeReady = 0;
  for (const poi of records) {
    const metric = poiMetadataKpi(poi);
    totalScore += metric.completeness;
    if (!metric.missing.includes('description') && !metric.missing.includes('source')) narrativeReady += 1;
    metric.missing.forEach((key) => { missing[key].count += 1; });
  }
  return {
    averageCompleteness: records.length ? Math.round(totalScore / records.length) : 0,
    narrativeReady,
    narrativeReadyRate: records.length ? Math.round(narrativeReady / records.length * 100) : 0,
    missing: Object.values(missing).sort((a, b) => b.count - a.count)
  };
}

function countJourneyRecords(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  return ['journeys', 'routes', 'trailSegments', 'features'].reduce((count, key) => count + (Array.isArray(payload[key]) ? payload[key].length : 0), 0);
}

function countCivicRecords(payload) {
  return Object.values(payload?.artifacts || {}).reduce((count, artifact) => count + (Array.isArray(artifact?.items) ? artifact.items.length : 0), 0);
}

function domainsFor(source) {
  const values = Array.isArray(source.domains) ? source.domains : [];
  return values.length ? values : ['general'];
}

function frontendFor(source) {
  const views = new Set(domainsFor(source).map((domain) => FRONTEND_PATHS[domain]).filter(Boolean));
  return views.size ? [...views].join(', ') : 'Producer package (no explicit view mapping)';
}

export function buildExperienceMetrics(records) {
  const categories = Object.fromEntries(DISCOVER_GROUPS.map((group) => [group.id, { id: group.id, label: group.label, featured: 0, published: 0, candidate: 0, total: 0, authority: { 'Government/institutional': 0, 'Open/community': 0, 'Unclassified/other': 0 } }]));
  const states = { featured: 0, published: 0, candidate: 0, personal: 0 };
  const tags = new Set();
  for (const poi of records) {
    const group = discoverGroupFor(poi);
    const stateName = publishingState(poi);
    const category = categories[group.id];
    category.total += 1;
    category[stateName] = (category[stateName] || 0) + 1;
    category.authority[authorityFamily(poi)] += 1;
    states[stateName] = (states[stateName] || 0) + 1;
    for (const tag of Array.isArray(poi.tags) ? poi.tags : [poi.category].filter(Boolean)) tags.add(tag);
  }
  return {
    total: records.length,
    categories: Object.values(categories),
    states,
    tags: [...tags],
    publishedCount: states.featured + states.published,
    nonemptyCategoryCount: Object.values(categories).filter((category) => category.total > 0).length
  };
}

export async function collectKpiInventory() {
  const regionDirectory = resolve(repoRoot, 'app', 'regions');
  const configs = [];
  for (const filename of await readdir(regionDirectory)) {
    if (extname(filename) !== '.json') continue;
    const config = await readJson(resolve(regionDirectory, filename));
    if (config?.id && config?.name && Array.isArray(config?.sources)) configs.push(config);
  }
  configs.sort((a, b) => a.name.localeCompare(b.name));

  const sources = configs.flatMap((region) => region.sources.map((source) => ({
    regionId: region.id,
    regionName: region.name,
    id: source.id,
    name: source.name,
    provider: source.provider,
    url: source.url,
    host: (() => { try { return new URL(source.url).hostname; } catch { return 'invalid URL'; } })(),
    domains: domainsFor(source),
    authority: source.authorityTier || 'unspecified',
    credential: source.credentialEnv || 'none',
    status: source.status || 'configured',
    frontend: frontendFor(source)
  })));

  const acquisitionReplay = await readJson(resolve(repoRoot, 'fixtures', 'acquisition', 'replay.json'), {});
  const acquisitionMetrics = {
    schema: 'acquisition-kpi.v1',
    regionsSearched: acquisitionReplay.root ? 1 : 0,
    plannedNeighbors: Array.isArray(acquisitionReplay.expected_neighbors) ? acquisitionReplay.expected_neighbors.length : 0,
    duplicateDomains: Array.isArray(acquisitionReplay.duplicate_domains) ? acquisitionReplay.duplicate_domains.length : 0,
    migrationRecovery: acquisitionReplay.migrated?.from && acquisitionReplay.migrated?.to ? 1 : 0,
    currentEventYield: 0,
    geocodedCoverage: null,
    sourceOfTruth: 'offline replay manifest only; live ledger is not published'
  };
  const packageCategories = [...new Set(configs.flatMap((region) => [
    ...(region.osm?.categories || []),
    ...(region.sources || []).flatMap((source) => source.domains || [])
  ]).map((category) => String(category).toLowerCase()).filter(Boolean))].sort();
  const packageIntelligence = {
    schema: 'package-intelligence-kpi.v1',
    configuredRegions: configs.length,
    regionsWithRequirements: configs.filter((region) => (region.osm?.categories || []).length || (region.sources || []).some((source) => (source.domains || []).length)).length,
    frontendCategories: packageCategories,
    sourceCount: sources.length,
    sourceBackedCategories: packageCategories.length,
    sourceOfTruth: 'repository region requirements and governed source definitions; acquisition results are not claimed until ledger evidence is published'
  };
  const reviewPackageDirectory = resolve(repoRoot, 'promotion-artifacts', 'packages');
  const reviewPackages = [];
  if (await exists(reviewPackageDirectory)) {
    for (const filename of (await readdir(reviewPackageDirectory)).filter((name) => name.endsWith('.json')).sort()) {
      const packagePayload = await readJson(resolve(reviewPackageDirectory, filename));
      if (!packagePayload?.packageId) continue;
      reviewPackages.push({
        packageId: packagePayload.packageId,
        geographyId: packagePayload.geography?.id || 'unknown',
        geographyQuery: packagePayload.geography?.query || 'unknown',
        status: packagePayload.status || 'READY FOR REVIEW',
        accepted: Array.isArray(packagePayload.records) ? packagePayload.records.length : 0,
        rejected: Array.isArray(packagePayload.rejected) ? packagePayload.rejected.length : 0,
        records: Array.isArray(packagePayload.records) ? packagePayload.records.map((row) => ({ recordId: row.record?.record_id, name: row.record?.name, category: row.record?.category })) : [],
        rejectedRecords: Array.isArray(packagePayload.rejected) ? packagePayload.rejected.map((row) => ({ recordId: row.recordId, reasons: Array.isArray(row.reasons) ? row.reasons : [] })) : [],
        gaps: Array.isArray(packagePayload.coverage?.gaps) ? packagePayload.coverage.gaps : [],
        generatedAt: packagePayload.generatedAt || null
      });
    }
  }
  packageIntelligence.reviewPackages = reviewPackages;
  packageIntelligence.reviewPackageSource = reviewPackages.length ? 'content-addressed repository artifacts' : 'no persisted review package artifacts found';
  const sourceProposalDirectory = resolve(repoRoot, 'promotion-artifacts', 'source-proposals');
  const sourceProposals = [];
  if (await exists(sourceProposalDirectory)) {
    for (const filename of (await readdir(sourceProposalDirectory)).filter((name) => name.endsWith('.json')).sort()) {
      const proposal = await readJson(resolve(sourceProposalDirectory, filename));
      if (proposal?.id && proposal?.url) sourceProposals.push(proposal);
    }
  }
  packageIntelligence.sourceProposals = sourceProposals;
  packageIntelligence.sourceProposalSource = sourceProposals.length ? 'repository-backed review artifacts' : 'no persisted source proposals found';

  const registrationRegistry = await readJson(resolve(repoRoot, 'app', 'endpoint-registrations.json'), { registrations: [] });
  const endpointHealth = await readJson(resolve(motherbirdRoot, 'data', 'endpoint-health.json'), { registrations: [] });
  const healthById = new Map((endpointHealth.registrations || []).map((entry) => [entry.id, entry.health]));
  const configById = new Map(configs.map((config) => [config.id, config]));
  const endpointRegistrations = [];
  for (const registration of registrationRegistry.registrations || []) {
    const binding = registration.binding || {};
    const region = configById.get(binding.regionId);
    const source = region?.sources?.find((candidate) => candidate.id === binding.sourceId);
    let configured = false;
    let configurationEvidence = 'No governed repository binding found';
    if (binding.kind === 'region-source') {
      configured = Boolean(source?.url && source?.provider);
      if (configured) configurationEvidence = `app/regions/${binding.regionId}.json → ${binding.sourceId}`;
    } else if (binding.kind === 'source-option') {
      const option = source?.providerOptions?.[binding.option];
      configured = Boolean(option?.provider && option?.url && option?.credentialEnv);
      if (configured) configurationEvidence = `app/regions/${binding.regionId}.json → ${binding.sourceId}.providerOptions.${binding.option}`;
    } else if (binding.kind === 'runtime') {
      const configExists = binding.configPath && await exists(resolve(repoRoot, binding.configPath));
      const workflowExists = binding.workflowPath && await exists(resolve(repoRoot, binding.workflowPath));
      configured = Boolean(configExists && workflowExists);
      if (configured) configurationEvidence = `${binding.configPath} + ${binding.workflowPath}`;
    }
    const health = healthById.get(registration.id) || registration.health || { status: 'not-checked' };
    const healthStatus = health.status || 'not-checked';
    const productionStatus = registration.production?.status || 'not-verified';
    endpointRegistrations.push({
      ...registration,
      configured,
      configurationEvidence,
      credentialStatus: registration.credentialEnv ? 'named-not-verified' : 'not-required-or-browser-public',
      healthStatus,
      healthCheckedAt: health.checkedAt || endpointHealth.checkedAt || null,
      productionStatus,
      nextAction: !configured
        ? 'Add a governed repository binding.'
        : healthStatus === 'blocked' && registration.credentialEnv
          ? `Provision ${registration.credentialEnv} in the runner, then execute a redacted health probe.`
          : healthStatus !== 'verified'
            ? 'Run and record a redacted health probe.'
            : productionStatus !== 'verified'
              ? 'Execute an import and record its manifest, row count, and freshness.'
              : 'Monitor freshness and failures.'
    });
  }

  const cities = [];
  for (const [cityId, city] of Object.entries(CITIES)) {
    const data = await readJson(appPath(city.dataFile));
    const supplementalFiles = [city.supplementalPoiFile, ...(city.supplementalPoiFiles || [])].filter(Boolean);
    const supplementals = await Promise.all(supplementalFiles.map((file) => readJson(appPath(file))));
    const journeys = await readJson(appPath(city.journeyFile));
    const civic = await readJson(appPath(city.civicFile));
    const requiredFiles = [city.dataFile, city.civicFile].filter(Boolean);
    const optionalFiles = [...supplementalFiles, city.journeyFile, city.weatherFile].filter(Boolean);
    const missingRequiredFiles = [];
    const missingOptionalFiles = [];
    for (const file of requiredFiles) if (!(await exists(appPath(file)))) missingRequiredFiles.push(file);
    for (const file of optionalFiles) if (!(await exists(appPath(file)))) missingOptionalFiles.push(file);
    const regionId = CITY_REGION_IDS[cityId] || cityId;
    const configuredSources = sources.filter((source) => source.regionId === regionId).length;
    const records = [poiRecords(data), ...supplementals.map(poiRecords)].flat();
    const poiCount = records.length;
    const journeyCount = countJourneyRecords(journeys);
    const civicExists = Boolean(city.civicFile && await exists(appPath(city.civicFile)));
    const readinessScore = (poiCount > 0 ? 30 : 0) + (civicExists ? 20 : 0) +
      (journeyCount > 0 ? 20 : 0) + (configuredSources > 0 ? 20 : 0) + 10;
    cities.push({
      cityId, regionId, name: city.name, state: city.state,
      poiCount,
      journeyCount,
      civicCount: countCivicRecords(civic),
      weather: city.weatherFile && await exists(appPath(city.weatherFile)) ? 'snapshot + live' : 'live on request',
      configuredSources,
      missingRequiredFiles,
      missingOptionalFiles,
      readinessScore,
      readinessLabel: readinessScore >= 80 ? 'Strong' : readinessScore >= 60 ? 'Usable' : 'Thin',
      status: missingRequiredFiles.length ? 'Core broken' : missingOptionalFiles.length ? 'Core ready · enhancements missing' : 'Fully referenced'
    });
    cities[cities.length - 1].experience = buildExperienceMetrics(records);
    cities[cities.length - 1].metadata = summarizeMetadata(records);
    cities[cities.length - 1].poiFiles = [city.dataFile, ...supplementalFiles].filter(Boolean);
  }
  cities.sort((a, b) => a.name.localeCompare(b.name));

  for (const city of cities) {
    const records = (await Promise.all(city.poiFiles.map((file) => readJson(appPath(file))))).flatMap(poiRecords);
    city.experience.guideSubjectCount = records.reduce((count, poi) => count + (Array.isArray(poi.notices) ? poi.notices.length : poi.notice ? 1 : 0), 0);
    city.experience.discoverReady = city.experience.publishedCount >= 24 && city.experience.nonemptyCategoryCount >= 2;
    city.experience.guideReady = city.experience.guideSubjectCount > 0;
    city.experience.launchStatus = city.experience.discoverReady && city.experience.guideReady ? 'Launch-ready' : city.experience.total > 0 ? 'Thin' : 'Content-blocked';
  }

  const backlog = await readJson(resolve(repoRoot, 'expansion-queues', 'regional-source-backlog.json'), {});
  const backlogItems = (backlog.regions || []).flatMap((region) => (region.queue || []).map((item) => ({ ...item, regionId: region.id, regionName: region.name })));
  const configuredRegionIds = new Set(configs.map((region) => region.id));
  const selectableRegionIds = new Set(cities.map((city) => city.regionId));
  const gaps = [
    ...cities.filter((city) => city.missingRequiredFiles.length).map((city) => ({
      priority: 'P0', severity: 'Core broken', region: city.name, detail: city.missingRequiredFiles.join(', '),
      action: 'Restore the required package or remove the region from CITIES.'
    })),
    ...cities.filter((city) => city.missingOptionalFiles.length).map((city) => ({
      priority: 'P1', severity: 'Enhancement missing', region: city.name, detail: city.missingOptionalFiles.join(', '),
      action: 'Generate the referenced enhancement or remove the stale optional reference.'
    })),
    ...configs.filter((region) => !selectableRegionIds.has(region.id)).map((region) => ({
      priority: 'P2', severity: 'Producer only', region: region.name, detail: 'Configured pipeline exists, but this region is not selectable in Mother Bird.',
      action: 'Build and review its Mother Bird package before adding it to CITIES.'
    })),
    ...cities.filter((city) => !configuredRegionIds.has(city.regionId)).map((city) => ({
      priority: 'P1', severity: 'Frontend only', region: city.name, detail: 'Selectable app package has no matching governed producer config.',
      action: 'Add a governed region config so future data can refresh reproducibly.'
    })),
    ...endpointRegistrations.filter((endpoint) => !endpoint.configured).map((endpoint) => ({
      priority: 'P1', severity: 'Registered only', region: endpoint.service,
      detail: 'Provider enrollment is verified, but no governed repository binding was found.', action: endpoint.nextAction
    })),
    ...endpointRegistrations.filter((endpoint) => endpoint.configured && endpoint.productionStatus !== 'verified').map((endpoint) => ({
      priority: endpoint.healthStatus === 'failed' ? 'P1' : 'P2', severity: 'Pipeline not producing', region: endpoint.service,
      detail: `Configured; credential ${endpoint.credentialStatus}; health ${endpoint.healthStatus}; production ${endpoint.productionStatus}.`, action: endpoint.nextAction
    }))
  ].sort((a, b) => a.priority.localeCompare(b.priority) || a.region.localeCompare(b.region));

  const providers = Object.entries(sources.reduce((counts, source) => {
    counts[source.provider] = (counts[source.provider] || 0) + 1; return counts;
  }, {})).map(([provider, count]) => ({ provider, count })).sort((a, b) => b.count - a.count);

  const workflowDirectory = resolve(repoRoot, '.github', 'workflows');
  const automationJobs = [];
  if (await exists(workflowDirectory)) {
    for (const filename of await readdir(workflowDirectory)) {
      if (!/\.ya?ml$/i.test(filename)) continue;
      const body = await readFile(resolve(workflowDirectory, filename), 'utf8');
      const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim() || filename;
      automationJobs.push({ name, filename, scheduled: /\bschedule\s*:/m.test(body), manual: /\bworkflow_dispatch\s*:/m.test(body) });
    }
  }

  const spatialConfig = await readJson(resolve(motherbirdRoot, 'regions', 'washington-dc', 'spatial-index.json'));
  const spatialManifest = await readJson(resolve(motherbirdRoot, 'regions', 'washington-dc', 'spatial', 'spatial-index-manifest.json'));
  const spatialSync = {
    regionId: spatialManifest?.regionId || 'washington-dc',
    poiVersion: spatialManifest?.syncIdentity?.poiVersion || null,
    boundaryVintage: spatialManifest?.syncIdentity?.boundaryVintage || null,
    poiCount: spatialManifest?.indexes?.pois?.featureCount || 0,
    boundaryCount: spatialManifest?.indexes?.boundaries?.featureCount || 0,
    packageVerified: Boolean(spatialManifest?.indexes?.pois?.recordFingerprint && spatialManifest?.inputs?.poi?.checksum),
    deploymentReady: Boolean(spatialConfig?.syncIdentity?.poiVersion && spatialConfig?.syncIdentity?.boundaryVintage),
    transport: 'disabled-local-outbox-only',
    closurePolicy: 'authenticated solo operator · immediate hide · 90 days · self-review',
    retentionVersions: 3
  };
  const federalPoiProgress = await readJson(resolve(motherbirdRoot, 'data', 'federal-region-poi-progress.json'));
  const federalProgressRegions = Object.keys(federalPoiProgress?.regions || {}).length;
  const federalTaggedPois = new Set(Object.values(federalPoiProgress?.regions || {}).flatMap((region) => region?.poiIds || [])).size;
  const federalProgressReady = federalPoiProgress?.schemaVersion === 1 && federalPoiProgress?.artifactType === 'federal-region-poi-progress' && federalTaggedPois > 0;

  const productCapabilities = [
    { capability: 'Discover', status: 'Shipped', evidence: `${DISCOVER_GROUPS.length} experience categories · relevant view capped at 24 places`, frontend: 'Map + Discover browser', next: 'Add distance-aware ranking and saved collections' },
    { capability: 'Field Guide', status: 'Pack-authored only', evidence: `${cities.reduce((count, city) => count + city.experience.guideSubjectCount, 0)} notices joined to packaged map pins`, frontend: 'Backpack · current viewport', next: 'Add reviewed notices to regional POI packages' },
    { capability: 'Journal', status: 'Shipped', evidence: 'Personal walks · observations · reflections · remembered places', frontend: 'Journal mode + local IndexedDB', next: 'Add collections and subject references without syncing private content' },
    { capability: 'Regional source backlog', status: 'Automated', evidence: `${Number(backlog?.summary?.candidateCount || 0)} candidates across ${Number(backlog?.summary?.regionCount || 0)} regions`, frontend: 'KPI operator queue', next: 'Promote passing official structured sources through review gates' },
    { capability: 'Pages inventory', status: 'Automated', evidence: 'Rebuilt from CITIES, artifacts, configs, endpoints, workflows, and UI contracts', frontend: '/kpi/', next: 'Add live endpoint health and freshness history' },
    { capability: 'Federal region progress', status: federalProgressReady ? 'Shipped · local-first' : 'Awaiting tagged POIs', evidence: federalProgressReady ? `${federalTaggedPois.toLocaleString()} tagged POIs · ${federalProgressRegions} federal regions · ${federalPoiProgress.congress}th Congress` : 'Canonical POI tag index is missing or empty', frontend: 'Map → Boundaries region readout', next: 'Re-run federal POI tagging after a POI refresh or Congress rollover' },
    { capability: 'DC spatial solo pilot', status: spatialSync.deploymentReady ? 'Package ready · transport off' : 'Identity blocked', evidence: `${spatialSync.poiCount.toLocaleString()} POIs · ${spatialSync.boundaryCount} boundaries · ${spatialSync.poiVersion || 'missing POI version'}`, frontend: 'Authenticated DC map closure control', next: 'Enable county transport only after a separately approved tenant deployment' },
    { capability: 'Passkey sign-in', status: 'Shipped', evidence: 'Supabase passkey flow supports device authentication without exposing biometric data', frontend: 'Phone and Watch account entry', next: 'Monitor Supabase passkey browser compatibility' }
  ];

  return {
    generatedAt: new Date().toISOString(), cities, configs: configs.map(({ id, name }) => ({ id, name })), sources, providers, gaps, backlogItems, automationJobs, productCapabilities, spatialSync, acquisitionMetrics, packageIntelligence, reviewPackages, sourceProposals,
    endpointRegistry: {
      asOf: registrationRegistry.asOf,
      evidencePolicy: registrationRegistry.evidencePolicy,
      registrations: endpointRegistrations
    },
    runtimeServices: [
      { service: 'NWS', endpoint: 'api.weather.gov', trigger: 'User requests live conditions', consumer: 'js/weather.js → weather brief', privacy: 'Uses selected region center; no user GPS sent' },
      { service: 'Open-Meteo', endpoint: 'api.open-meteo.com', trigger: 'User requests live conditions', consumer: 'js/weather.js → weather brief', privacy: 'Uses selected region center; no user GPS sent' },
      { service: 'Sunrise-Sunset', endpoint: 'api.sunrise-sunset.org', trigger: 'User requests live conditions', consumer: 'js/weather.js → daylight text', privacy: 'Uses selected region center; no user GPS sent' },
      { service: 'Supabase', endpoint: 'Configured project URL', trigger: 'Authenticated app use; heartbeat at most every 7 days', consumer: 'js/online.js → profile sync/heartbeat', privacy: 'No secret keys; minimal account activity heartbeat' }
    ],
    summary: {
      selectableRegions: cities.length,
      producerRegions: configs.length,
      configuredEndpoints: sources.length,
      registeredAccounts: endpointRegistrations.length,
      registeredConfigured: endpointRegistrations.filter((endpoint) => endpoint.configured).length,
      registeredHealthy: endpointRegistrations.filter((endpoint) => endpoint.healthStatus === 'verified').length,
      registeredProducing: endpointRegistrations.filter((endpoint) => endpoint.productionStatus === 'verified').length,
      credentialedEndpoints: sources.filter((source) => source.credential !== 'none').length,
      coreReadyRegions: cities.filter((city) => city.missingRequiredFiles.length === 0).length,
      fullyReferencedRegions: cities.filter((city) => city.missingRequiredFiles.length === 0 && city.missingOptionalFiles.length === 0).length,
      averageReadiness: Math.round(cities.reduce((sum, city) => sum + city.readinessScore, 0) / Math.max(cities.length, 1)),
      backlogCandidates: Number(backlog?.summary?.candidateCount || 0),
      readyBacklog: Number(backlog?.summary?.classifications?.READY || 0),
      gaps: gaps.length,
      p0Gaps: gaps.filter((gap) => gap.priority === 'P0').length,
      p1Gaps: gaps.filter((gap) => gap.priority === 'P1').length,
      experienceModes: 3,
      discoverCategories: DISCOVER_GROUPS.length,
      fieldGuideSubjects: cities.reduce((count, city) => count + city.experience.guideSubjectCount, 0),
      federalTaggedPois,
      federalProgressRegions,
      workflowCount: automationJobs.length,
      scheduledWorkflowCount: automationJobs.filter((job) => job.scheduled).length,
      launchReadyRegions: cities.filter((city) => city.experience.launchStatus === 'Launch-ready').length,
      thinExperienceRegions: cities.filter((city) => city.experience.launchStatus === 'Thin').length,
      contentBlockedRegions: cities.filter((city) => city.experience.launchStatus === 'Content-blocked').length
      ,spatialSyncReady: spatialSync.deploymentReady
      ,spatialIndexedPois: spatialSync.poiCount
      ,averagePoiMetadata: Math.round(cities.reduce((sum, city) => sum + city.metadata.averageCompleteness * city.poiCount, 0) / Math.max(cities.reduce((sum, city) => sum + city.poiCount, 0), 1))
      ,narrativeReadyPois: cities.reduce((sum, city) => sum + city.metadata.narrativeReady, 0)
    }
  };
}

function renderRows(rows, columns) {
  return rows.map((row) => `<tr>${columns.map((column) => `<td data-label="${escapeHtml(column.label)}">${column.render ? column.render(row) : escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('');
}

export function renderKpiHtml(model) {
  const { summary } = model;
  const packageRows = model.reviewPackages.map((item) => `<tr><td><code>${escapeHtml(item.packageId)}</code><br><label><input type="checkbox" data-package-approval="${escapeHtml(item.packageId)}" disabled> Approve package</label></td><td>${escapeHtml(item.geographyQuery)}<br><small>${escapeHtml(item.geographyId)}</small></td><td><span class="pill ${item.status === 'PROMOTED' ? 'good' : item.status === 'APPROVED' ? 'good' : 'warn'}">${escapeHtml(item.status)}</span></td><td>${item.records.map((record) => `<label><input type="checkbox" data-package-record="${escapeHtml(item.packageId)}:${escapeHtml(record.recordId || '')}" disabled> ${escapeHtml(record.name || record.recordId || 'unnamed')} <small>(${escapeHtml(record.category || 'unknown')})</small></label>`).join('<br>') || 'No accepted records'}</td><td>${item.rejectedRecords.length ? `<details><summary>${item.rejectedRecords.length} rejected</summary>${item.rejectedRecords.map((record) => `<div><code>${escapeHtml(record.recordId || 'unnamed')}</code>: ${escapeHtml(record.reasons.join(' · ') || 'quality gate failed')}</div>`).join('') }</details>` : '0'}</td><td>${escapeHtml(item.gaps.join(' · ') || 'None recorded')}</td></tr>`).join('');
  const cards = [
    ['Experience modes', summary.experienceModes, `${summary.discoverCategories} Discover categories · ${summary.fieldGuideSubjects} Guide subjects`],
    ['Core-ready regions', summary.coreReadyRegions, `of ${summary.selectableRegions} selectable regions load required place + civic packages`],
    ['Average readiness', `${summary.averageReadiness}%`, 'Places 30 · civic 20 · walks 20 · producer 20 · conditions 10'],
    ['Producer regions', summary.producerRegions, 'Governed region source configurations'],
    ['Configured endpoints', summary.configuredEndpoints, `${summary.credentialedEndpoints} require a named Actions secret`],
    ['Registered accounts', summary.registeredAccounts, `${summary.registeredConfigured} configured · ${summary.registeredHealthy} health-verified · ${summary.registeredProducing} producing`],
    ['DC spatial package', summary.spatialIndexedPois.toLocaleString(), summary.spatialSyncReady ? 'Identity approved · local-only sync transport' : 'Identity needs approval'],
    ['Review backlog', summary.backlogCandidates, `${summary.readyBacklog} classified READY`],
    ['National acquisition', model.acquisitionMetrics.plannedNeighbors, `${model.acquisitionMetrics.regionsSearched} replay region · ${model.acquisitionMetrics.duplicateDomains} duplicate domains`],
    ['Package requirements', model.packageIntelligence.frontendCategories.length, `${model.packageIntelligence.configuredRegions} configured regions · source-backed categories`],
    ['Priority repairs', summary.p0Gaps + summary.p1Gaps, `${summary.p0Gaps} P0 · ${summary.p1Gaps} P1`]
  ];
  const sourceRows = renderRows(model.sources, [
    { key: 'regionName', label: 'Region' }, { key: 'name', label: 'Source' }, { key: 'provider', label: 'Provider' },
    { key: 'domains', label: 'Data', render: (r) => escapeHtml(r.domains.join(', ')) },
    { key: 'host', label: 'Endpoint', render: (r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">${escapeHtml(r.host)} ↗</a>` },
    { key: 'credential', label: 'Credential' }, { key: 'frontend', label: 'Frontend connection' }
  ]);
  const cityRows = renderRows(model.cities, [
    { key: 'name', label: 'App region', render: (r) => `${escapeHtml(r.name)}, ${escapeHtml(r.state)}` },
    { key: 'poiCount', label: 'Places' }, { key: 'journeyCount', label: 'Walks/routes' }, { key: 'civicCount', label: 'Civic items' },
    { key: 'weather', label: 'Conditions' }, { key: 'configuredSources', label: 'Producer sources' },
    { key: 'readinessScore', label: 'Readiness', render: (r) => `<div class="score"><span style="width:${r.readinessScore}%"></span></div><b>${r.readinessScore}% · ${escapeHtml(r.readinessLabel)}</b>` },
    { key: 'status', label: 'References', render: (r) => `<span class="pill ${r.missingRequiredFiles.length ? 'bad' : r.missingOptionalFiles.length ? 'warn' : 'good'}">${escapeHtml(r.status)}</span>` }
  ]);
  const gapRows = renderRows(model.gaps, [
    { key: 'priority', label: 'Priority', render: (r) => `<span class="pill ${r.priority === 'P0' ? 'bad' : r.priority === 'P1' ? 'warn' : ''}">${r.priority}</span>` },
    { key: 'severity', label: 'Type' }, { key: 'region', label: 'Region' }, { key: 'detail', label: 'What is not connected' },
    { key: 'action', label: 'Next action' }
  ]);
  const runtimeRows = renderRows(model.runtimeServices, [
    { key: 'service', label: 'Service' }, { key: 'endpoint', label: 'Endpoint' }, { key: 'trigger', label: 'When called' },
    { key: 'consumer', label: 'Frontend consumer' }, { key: 'privacy', label: 'Privacy boundary' }
  ]);
  const registrationRows = renderRows(model.endpointRegistry.registrations, [
    { key: 'service', label: 'Registered product' },
    { key: 'registeredAt', label: 'Registered' },
    { key: 'configured', label: 'Configured', render: (r) => r.configured ? '<span class="pill good">Yes</span>' : '<span class="pill bad">No</span>' },
    { key: 'credentialStatus', label: 'Credential' },
    { key: 'healthStatus', label: 'Health' },
    { key: 'productionStatus', label: 'Producing' },
    { key: 'nextAction', label: 'Next evidence gate' }
  ]);
  const capabilityRows = renderRows(model.productCapabilities, [
    { key: 'capability', label: 'Capability' }, { key: 'status', label: 'Status', render: (r) => `<span class="pill ${/shipped|automated/i.test(r.status) ? 'good' : 'warn'}">${escapeHtml(r.status)}</span>` },
    { key: 'evidence', label: 'Observable evidence' }, { key: 'frontend', label: 'User/operator surface' }, { key: 'next', label: 'Next automation step' }
  ]);
  const workflowRows = renderRows(model.automationJobs, [
    { key: 'name', label: 'Workflow' }, { key: 'filename', label: 'File' },
    { key: 'scheduled', label: 'Scheduled', render: (r) => r.scheduled ? '<span class="pill good">Yes</span>' : 'No' },
    { key: 'manual', label: 'Manual run', render: (r) => r.manual ? 'Available' : 'Not declared' }
  ]);
  const providerBars = model.providers.slice(0, 10).map(({ provider, count }) => `<div class="bar-row"><span>${escapeHtml(provider)}</span><div class="bar"><i style="width:${Math.max(4, count / model.providers[0].count * 100)}%"></i></div><strong>${count}</strong></div>`).join('');
  const readinessBands = [
    ['Strong', model.cities.filter((city) => city.readinessScore >= 80).length, 'good'],
    ['Usable', model.cities.filter((city) => city.readinessScore >= 60 && city.readinessScore < 80).length, 'warn'],
    ['Needs work', model.cities.filter((city) => city.readinessScore < 60).length, 'bad']
  ];
  const readinessBars = readinessBands.map(([label, count, tone]) => `<div class="metric-bar"><span>${label}</span><div class="bar"><i class="${tone}" style="width:${Math.max(4, count / Math.max(model.cities.length, 1) * 100)}%"></i></div><b>${count}</b></div>`).join('');
  const categoryCounts = model.packageIntelligence.frontendCategories.map((category) => ({ category, count: model.sources.filter((source) => source.domains.includes(category)).length })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
  const categoryBars = categoryCounts.map(({ category, count }) => `<div class="metric-bar"><span>${escapeHtml(category)}</span><div class="bar"><i style="width:${Math.max(4, count / Math.max(categoryCounts[0]?.count || 1, 1) * 100)}%"></i></div><b>${count}</b></div>`).join('');
  const pipelineStages = [
    ['Registered', model.summary.registeredAccounts],
    ['Configured', model.summary.registeredConfigured],
    ['Healthy', model.summary.registeredHealthy],
    ['Producing', model.summary.registeredProducing]
  ];
  const pipelineBars = pipelineStages.map(([label, count], index) => `<div class="metric-bar"><span>${label}</span><div class="bar"><i style="width:${Math.max(4, count / Math.max(model.summary.registeredAccounts, 1) * 100)}%"></i></div><b>${count}</b></div>`).join('');
  const gatePackage = model.reviewPackages.find((item) => /portland/i.test(`${item.geographyId} ${item.geographyQuery}`));
  const gateGaps = gatePackage?.gaps || [];
  const gateRejected = gatePackage?.rejectedRecords?.length || 0;
  const gateReady = Boolean(gatePackage && gatePackage.records?.length && !gateGaps.length && !gateRejected);
  const gateQueued = model.cities.filter((city) => !/portland/i.test(city.name)).slice(0, 5).map((city, index) => `<li><span>${index + 1}. ${escapeHtml(city.name)}, ${escapeHtml(city.state)}</span><span class="pill warn">QUEUED</span></li>`).join('') || '<li class="empty">No next region queued.</li>';
  const gateMarkup = `<section class="panel rollout-panel" id="regionalRollout"><div class="rollout-head"><div><span class="eyebrow">Controlled progression</span><h2>Regional rollout gate</h2><p>Portland is the active target. New regions stay queued until adapters, package coverage, validation, deduplication, and human readiness all pass.</p></div><span class="pill ${gateReady ? 'good' : 'bad'}">${gateReady ? 'READY FOR HUMAN TOGGLE' : 'BLOCKED'}</span></div><div class="rollout-grid"><div><h3>Current active target</h3><div class="target-card"><b>Portland</b><span>replay-portland</span><small>${gateReady ? 'Automated evidence is complete; advancement still requires the moderator toggle.' : 'Improve the Portland package and adapter path before advancing.'}</small></div><div class="gate-list"><div class="gate-check"><span class="pill ${gatePackage ? 'good' : 'warn'}">${gatePackage ? 'PASS' : 'BLOCKED'}</span><b>Adapter chain</b></div><div class="gate-check"><span class="pill ${gatePackage?.records?.length && !gateGaps.length ? 'good' : 'warn'}">${gatePackage?.records?.length && !gateGaps.length ? 'PASS' : 'BLOCKED'}</span><b>Package coverage</b><small>${gateGaps.length ? `${gateGaps.length} gap(s)` : 'Required categories covered'}</small></div><div class="gate-check"><span class="pill ${gateRejected ? 'warn' : 'good'}">${gateRejected ? 'BLOCKED' : 'PASS'}</span><b>Deduplication / validation</b><small>${gateRejected ? `${gateRejected} rejected record(s)` : 'No rejected records'}</small></div><div class="gate-check"><span class="pill warn">BLOCKED</span><b>Human readiness</b><small>Moderator must explicitly toggle advancement</small></div></div></div><div><h3>Next regions queued</h3><ul class="queue-list">${gateQueued}</ul><div class="toolbar"><label class="toggle-row"><input type="checkbox" id="advanceRegionToggle" disabled> <span>Advance to next region</span></label><span id="rolloutAuthStatus" class="pill warn">Moderator sign-in required</span></div><small class="note">The toggle is passkey-gated and remains disabled until authenticated approval is available.</small></div></div></section>`;
  const operatorRows = gateMarkup + model.backlogItems.filter((item) => item.classification === 'INVESTIGATE' || item.classification === 'READY').map((item) => `<tr><td><input type="checkbox" data-approval-id="${escapeHtml(item.id)}" disabled></td><td><span class="pill ${item.classification === 'READY' ? 'good' : 'warn'}">${escapeHtml(item.classification)}</span></td><td>${escapeHtml(item.regionName)}</td><td><b>${escapeHtml(item.publisher)}</b><br><a href="${escapeHtml(item.url)}" rel="noreferrer">${escapeHtml(item.url)}</a></td><td>${escapeHtml(item.likelyDataType || item.dataType || 'Unknown')}</td></tr>`).join('');
  const sourceProposalRows = model.sourceProposals.map((proposal) => `<tr><td><code>${escapeHtml(proposal.id)}</code><br><label><input type="checkbox" data-source-proposal-approval="${escapeHtml(proposal.id)}" disabled> Approve source</label></td><td>${escapeHtml(proposal.geographyId || 'unknown')}</td><td><span class="pill ${proposal.status === 'APPROVED' ? 'good' : 'warn'}">${escapeHtml(proposal.status || 'PROPOSED')}</span></td><td><a href="${escapeHtml(proposal.url)}" rel="noreferrer">${escapeHtml(proposal.url)}</a><br><small>${escapeHtml((proposal.domains || []).join(' · '))}</small></td><td>${escapeHtml(proposal.evidence?.query || 'No query evidence')}<br><small>${escapeHtml(proposal.evidence?.reason || '')}</small></td><td>${escapeHtml(proposal.publication || 'not authorized')}</td></tr>`).join('');
  const activePackage = model.reviewPackages.find((item) => /portland/i.test(`${item.geographyId} ${item.geographyQuery}`));
  const activeGaps = activePackage?.gaps || [];
  const activeRejected = activePackage?.rejectedRecords?.length || 0;
  const activeAutomatedReady = Boolean(activePackage && activePackage.records?.length && !activeGaps.length && !activeRejected);
  const queuedRegions = model.cities.filter((city) => !/portland/i.test(city.name)).slice(0, 5);
  const rolloutChecks = [['Adapter chain', Boolean(activePackage), activePackage ? 'Package evidence exists' : 'No Portland package evidence'], ['Package coverage', Boolean(activePackage?.records?.length && !activeGaps.length), activeGaps.length ? `${activeGaps.length} coverage gap(s)` : 'Required categories covered'], ['Deduplication', activeRejected === 0, activeRejected ? `${activeRejected} rejected record(s) remain` : 'No rejected records in package'], ['Validation', Boolean(activePackage && !activeRejected), activePackage ? 'Package validation passed' : 'Awaiting package'], ['Human readiness', false, 'Moderator must explicitly toggle advancement']];
  const rolloutCheckMarkup = rolloutChecks.map(([label, passed, detail]) => `<div class="gate-check"><span class="pill ${passed ? 'good' : 'warn'}">${passed ? 'PASS' : 'BLOCKED'}</span><div><b>${escapeHtml(label)}</b><small>${escapeHtml(detail)}</small></div></div>`).join('');
  const queuedMarkup = queuedRegions.map((city, index) => `<li><span>${index + 1}. ${escapeHtml(city.name)}, ${escapeHtml(city.state)}</span><span class="pill warn">QUEUED</span></li>`).join('') || '<li class="empty">No next region is queued.</li>';
  const rolloutMarkup = `<section class="panel rollout-panel" id="regionalRollout"><div class="rollout-head"><div><span class="eyebrow">Controlled progression</span><h2>Regional rollout gate</h2><p>Portland is the active target. New regions stay queued until package coverage, adapters, validation, deduplication, and a human readiness decision all pass.</p></div><span class="pill ${activeAutomatedReady ? 'good' : 'bad'}">${activeAutomatedReady ? 'READY FOR HUMAN TOGGLE' : 'BLOCKED'}</span></div><div class="rollout-grid"><div><h3>Current active target</h3><div class="target-card"><b>Portland</b><span>replay-portland</span><small>${activeAutomatedReady ? 'Automated evidence is complete; advancement still requires the moderator toggle.' : 'Improve the Portland package and adapter path before advancing.'}</small></div><div class="gate-list">${rolloutCheckMarkup}</div></div><div><h3>Next regions queued</h3><ul class="queue-list">${queuedMarkup}</ul><div class="toolbar"><label class="toggle-row"><input type="checkbox" id="advanceRegionToggle" disabled> <span>Advance to next region</span></label><span id="rolloutAuthStatus" class="pill warn">Moderator sign-in required</span></div><small class="note">This control remains disabled until passkey authentication succeeds. The queue is advisory until the explicit approval is saved.</small></div></div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gremlin Labs data & capability index</title><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0"></script><script src="../supabase-config.js"></script>
 <style>:root{--ink:#17221d;--muted:#5f6d65;--paper:#f5f2e9;--card:#fffdf7;--line:#d8d2c2;--green:#287454;--mint:#dcecdf;--amber:#9b6500;--red:#9b3c2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:48px 0 24px}h1{font:700 clamp(2rem,5vw,4.4rem)/.98 Georgia,serif;max-width:900px;margin:.25rem 0 1rem}h2{font:700 1.55rem Georgia,serif;margin:0 0 .35rem}p{color:var(--muted)}.eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:var(--green);font-weight:800}.updated{font-size:.85rem}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:24px 0}.card,.panel,.folder{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 18px #203b2810}.card{padding:18px}.card b{display:block;font:700 2.2rem Georgia,serif;color:var(--green)}.card small{color:var(--muted)}.panel{padding:22px;margin:0 0 20px;overflow:hidden}.folder{margin:0 0 18px;padding:0;overflow:hidden}.folder>summary{cursor:pointer;list-style:none;padding:18px 22px;background:linear-gradient(90deg,var(--mint),var(--card));font:700 1.2rem Georgia,serif}.folder>summary::-webkit-details-marker{display:none}.folder>summary:before{content:'＋';display:inline-block;width:1.4em;color:var(--green)}.folder[open]>summary:before{content:'−'}.folder-body{padding:18px 0 2px}.folder-body>.panel{border:0;border-radius:0;box-shadow:none;border-top:1px solid var(--line);margin:0}.folder-body>.panel:first-child{border-top:0}.overview{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:14px;margin:20px 0}.overview-card{padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.overview-card b{display:block;font:700 2rem Georgia,serif;color:var(--green)}.overview-card small{color:var(--muted)}.mini-meter{height:10px;background:#ebe7dc;border-radius:99px;overflow:hidden;margin:10px 0 5px}.mini-meter i{display:block;height:100%;background:var(--green)}.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:28px;margin-top:18px}.flow div{background:var(--mint);padding:14px;border-radius:12px;position:relative}.flow div:not(:last-child):after{content:'→';position:absolute;right:-22px;top:30%;font-weight:800;color:var(--green)}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select{min-height:42px;border:1px solid var(--line);background:white;border-radius:10px;padding:8px 12px;font:inherit}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;font-size:.88rem}th{text-align:left;color:var(--muted);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}th,td{padding:11px 9px;border-bottom:1px solid #e5e0d4;vertical-align:top}a{color:var(--green)}.pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:.75rem;font-weight:700}.good{background:var(--mint);color:var(--green)}.warn{background:#f8e9c5;color:var(--amber)}.bad{background:#f7ded8;color:var(--red)}.score{height:7px;width:90px;background:#ebe7dc;border-radius:99px;overflow:hidden;margin-bottom:4px}.score span{display:block;height:100%;background:var(--green)}.bar-row{display:grid;grid-template-columns:190px 1fr 35px;gap:10px;align-items:center;margin:9px 0}.bar{height:12px;background:#ebe7dc;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--green);border-radius:99px}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.note{border-left:4px solid var(--green);padding-left:14px}.provenance{margin-top:14px}.provenance summary{cursor:pointer;color:var(--green);font-weight:700}.empty{padding:24px;text-align:center;color:var(--muted)}footer{padding:24px 0 50px;color:var(--muted)}@media(max-width:1100px){.cards{grid-template-columns:repeat(3,1fr)}.overview{grid-template-columns:1fr 1fr}}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.flow,.two{grid-template-columns:1fr}.flow div:not(:last-child):after{content:'↓';right:50%;top:auto;bottom:-26px}}@media(max-width:650px){header,main{width:min(100% - 20px,1440px)}header{padding-top:28px}.cards{grid-template-columns:1fr 1fr}.card{padding:14px}.card b{font-size:1.8rem}.panel{padding:16px}.overview{grid-template-columns:1fr}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px 0;border-bottom:1px solid var(--line)}td{border:0;padding:4px 0 4px 42%}td:before{content:attr(data-label);float:left;margin-left:-72%;width:68%;color:var(--muted);font-size:.72rem;text-transform:uppercase}.bar-row{grid-template-columns:120px 1fr 28px}}</style></head><body>
 <header id="top"><div class="eyebrow">Gremlin Labs · operator dashboard</div><h1>Data & capability index</h1><p>One repository-backed view of what Mother Bird can show, where the data originates, how it is transformed, and what is not connected yet.</p><p class="updated">Generated ${escapeHtml(model.generatedAt)} during the Pages build. Counts describe repository state—not a claim of geographic completeness.</p></header><main><nav id="sectionNav" aria-label="Dashboard folders" class="folder-nav"></nav><section class="overview" aria-label="Dashboard overview"><article class="overview-card"><span>Overall readiness</span><b>${summary.averageReadiness}%</b><div class="mini-meter"><i style="width:${summary.averageReadiness}%"></i></div><small>${summary.coreReadyRegions} of ${summary.selectableRegions} regions core-ready</small></article><article class="overview-card"><span>Acquisition coverage</span><b>${model.packageIntelligence.configuredRegions} regions</b><div class="mini-meter"><i style="width:${Math.round(model.packageIntelligence.configuredRegions / Math.max(summary.selectableRegions,1) * 100)}%"></i></div><small>${model.packageIntelligence.sourceCount} governed source definitions</small></article><article class="overview-card"><span>Open repair queue</span><b>${summary.p0Gaps + summary.p1Gaps} P0/P1</b><div class="mini-meter"><i class="risk" style="width:${Math.min(100, (summary.p0Gaps + summary.p1Gaps) * 4)}%"></i></div><small>${summary.backlogCandidates} discovery candidates · ${summary.readyBacklog} ready</small></article></section><section class="visual-grid" aria-label="Dashboard visuals"><article class="visual-card"><h2>Regional readiness mix</h2><p>Selectable regions grouped by their current readiness score.</p>${readinessBars}</article><article class="visual-card"><h2>Source coverage by category</h2><p>Configured endpoints mapped to the frontend categories they can feed.</p>${categoryBars || '<span class="empty">No category coverage recorded.</span>'}</article><article class="visual-card"><h2>Account-to-data funnel</h2><p>Each stage requires separate evidence; registration does not imply production.</p>${pipelineBars}</article></section><script>document.addEventListener('DOMContentLoaded',()=>{const nav=document.querySelector('#sectionNav');const sections=[...document.querySelectorAll('main>.panel')];const groups=[['Review & acquisition',[0,1,2,3,4], 'Source review, package evidence, and how data reaches walkers'],['Delivery & readiness',[5,6,7,8,9], 'Account health, product delivery, geography, and repair actions'],['Systems & governance',[10,11,12,13,14], 'Providers, endpoints, live services, automation, and KPI definitions']];groups.forEach(([label,indexes,summaryText],groupIndex)=>{const details=document.createElement('details');details.className='folder';details.open=groupIndex===0;const title=document.createElement('summary');title.textContent=label+' · '+summaryText;details.appendChild(title);const body=document.createElement('div');body.className='folder-body';indexes.forEach((index)=>{const section=sections[index];if(section){section.id='section-'+index;body.appendChild(section);const link=document.createElement('a');link.href='#section-'+index;link.textContent=section.querySelector('h2')?.textContent||'Section';link.className='folder-link';nav.appendChild(link)}});details.appendChild(body);document.querySelector('main').insertBefore(details,document.querySelector('footer'));});nav.setAttribute('aria-label','Dashboard folders');});</script>
<section class="cards">${cards.map(([label,value,note])=>`<article class="card"><span>${escapeHtml(label)}</span><b>${value}</b><small>${escapeHtml(note)}</small></article>`).join('')}</section>
<section class="panel" id="operatorGate"><h2>Operator source review</h2><p>Public visitors can inspect this queue. Moderator controls require your passkey; approvals are stored in Supabase and protected by Row Level Security.</p><div class="toolbar"><button class="primary-button" id="operatorPasskey" type="button">Sign in with passkey</button><span id="operatorAuthStatus" class="pill warn">Moderator sign-in required</span></div><div id="operatorControls" hidden><p class="note">Check a source only after validating its payload, attribution, date/freshness behavior, accessibility or free-entry claim, and adapter contract. These marks do not publish data.</p><table><thead><tr><th>Approve</th><th>Status</th><th>Region</th><th>Source</th><th>Detected type</th></tr></thead><tbody>${operatorRows || '<tr><td colspan="5" class="empty">No review candidates.</td></tr>'}</tbody></table></div></section>
<section class="panel"><h2>How data reaches a walker</h2><p>Secrets stay in scheduled producer jobs. Published browser assets contain reviewed outputs, never credential values.</p><div class="flow"><div><b>Official source</b><br><small>ArcGIS, APIs, RSS/ICS, open data</small></div><div><b>Provider adapter</b><br><small>Fetch, normalize, validate</small></div><div><b>Governed artifact</b><br><small>Attribution, stable IDs, freshness</small></div><div><b>Mother Bird package</b><br><small>POIs, journeys, civic, conditions</small></div><div><b>Frontend view</b><br><small>Map, Walks, Vote, Volunteer, Events</small></div></div></section>
<section class="panel"><h2>Package intelligence</h2><p>The backend plans against declared frontend needs and source definitions. These are coverage requirements, not claims that acquisition has succeeded.</p><table><tbody><tr><th>Configured regions</th><td>${model.packageIntelligence.configuredRegions}</td></tr><tr><th>Regions with requirements</th><td>${model.packageIntelligence.regionsWithRequirements}</td></tr><tr><th>Source-backed categories</th><td>${escapeHtml(model.packageIntelligence.frontendCategories.join(' · ') || 'No category requirements recorded')}</td></tr><tr><th>Governed source definitions</th><td>${model.packageIntelligence.sourceCount}</td></tr><tr><th>Evidence policy</th><td>${escapeHtml(model.packageIntelligence.sourceOfTruth)}</td></tr></tbody></table></section>
<section class="panel"><h2>Review packages</h2><p>Content-addressed package artifacts are evidence for review only. Package approval and record selection are authenticated Supabase actions; publication remains a separate protected workflow.</p><table><thead><tr><th>Package</th><th>Geography</th><th>Status</th><th>Select records</th><th>Rejected</th><th>Coverage gaps</th></tr></thead><tbody>${packageRows || '<tr><td colspan="6" class="empty">No persisted review package artifacts found. Acquisition has not been represented as publication.</td></tr>'}</tbody></table><p class="note">Evidence source: ${escapeHtml(model.packageIntelligence.reviewPackageSource)}</p></section>
<section class="panel"><h2>Discovered source proposals</h2><p>Search results become review-only proposals. A proposal is not a governed source, fetch authorization, or publication approval. Moderator approval is recorded separately in Supabase.</p><table><thead><tr><th>Proposal</th><th>Geography</th><th>Status</th><th>Candidate source</th><th>Discovery evidence</th><th>Publication</th></tr></thead><tbody>${sourceProposalRows || '<tr><td colspan="6" class="empty">No persisted source proposals found.</td></tr>'}</tbody></table><p class="note">Evidence source: ${escapeHtml(model.packageIntelligence.sourceProposalSource)}</p></section>
<section class="panel"><h2>Account-to-data pipeline</h2><p>${escapeHtml(model.endpointRegistry.evidencePolicy)} Registry evidence is current through ${escapeHtml(model.endpointRegistry.asOf)}.</p><table><thead><tr><th>Registered product</th><th>Registered</th><th>Configured</th><th>Credential</th><th>Health</th><th>Producing</th><th>Next evidence gate</th></tr></thead><tbody>${registrationRows}</tbody></table></section>
<section class="panel"><h2>Product delivery progress</h2><p>Observable UI behavior and automation foundations detected from the same code and repository contracts deployed to Pages.</p><table><thead><tr><th>Capability</th><th>Status</th><th>Observable evidence</th><th>User/operator surface</th><th>Next automation step</th></tr></thead><tbody>${capabilityRows}</tbody></table></section>
<section class="panel"><h2>DC spatial solo-pilot KPI</h2><p>Package identity and local-closure operating policy. This is not a claim that county network sync is running.</p><table><tbody><tr><th>Package</th><td>${escapeHtml(model.spatialSync.poiVersion || 'Not approved')} · ${escapeHtml(model.spatialSync.boundaryVintage || 'Not approved')}</td></tr><tr><th>Indexed records</th><td>${model.spatialSync.poiCount.toLocaleString()} POIs · ${model.spatialSync.boundaryCount.toLocaleString()} boundaries</td></tr><tr><th>Verification</th><td>${model.spatialSync.packageVerified ? 'Checksummed package + runtime fingerprint' : 'Missing verification evidence'}</td></tr><tr><th>Closure policy</th><td>${escapeHtml(model.spatialSync.closurePolicy)}</td></tr><tr><th>Transport</th><td>${escapeHtml(model.spatialSync.transport)} · retain ${model.spatialSync.retentionVersions} canonical versions after a future deployment</td></tr></tbody></table></section>
<section class="panel"><h2>Regional readiness</h2><p>Counts are records the deployed app can load through <code>CITIES</code>. Readiness is a transparent product score: places 30 points, civic package 20, plotted walks 20, governed producer 20, and private region-center conditions 10.</p><div class="table-wrap"><table><thead><tr><th>App region</th><th>Places</th><th>Walks/routes</th><th>Civic items</th><th>Conditions</th><th>Producer sources</th><th>Readiness</th><th>References</th></tr></thead><tbody>${cityRows}</tbody></table></div></section>
<section class="panel"><h2>Prioritized repair queue</h2><p>P0 blocks a required app package. P1 is a stale enhancement reference or missing governed producer. P2 is usable producer work waiting for frontend packaging.</p><div class="toolbar"><select id="gapFilter"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option></select></div><table id="gapTable"><thead><tr><th>Priority</th><th>Type</th><th>Region</th><th>What is not connected</th><th>Next action</th></tr></thead><tbody>${gapRows || '<tr><td colspan="5" class="empty">No connection gaps detected.</td></tr>'}</tbody></table></section>
<section class="panel"><h2>Provider mix</h2><p>Configured source endpoints by acquisition adapter.</p>${providerBars}</section>
<section class="panel"><h2>Endpoint inventory</h2><p>Every governed geographic source in <code>app/regions</code>. Credential names identify the required GitHub Actions secret; values are never read or published.</p><div class="toolbar"><input id="sourceSearch" type="search" placeholder="Search region, source, endpoint, or frontend…"><select id="providerFilter"><option value="">All providers</option>${model.providers.map(({provider})=>`<option>${escapeHtml(provider)}</option>`).join('')}</select></div><table id="sourceTable"><thead><tr><th>Region</th><th>Source</th><th>Provider</th><th>Data</th><th>Endpoint</th><th>Credential</th><th>Frontend connection</th></tr></thead><tbody>${sourceRows}</tbody></table><p id="sourceEmpty" class="empty" hidden>No endpoints match those filters.</p></section>
<section class="panel"><h2>Live browser services</h2><p>These calls are separate from scheduled producer endpoints. They are invoked by explicit app behavior and follow the listed privacy boundary.</p><table><thead><tr><th>Service</th><th>Endpoint</th><th>When called</th><th>Frontend consumer</th><th>Privacy boundary</th></tr></thead><tbody>${runtimeRows}</tbody></table></section>
<section class="panel"><h2>Repository automation</h2><p>${summary.workflowCount} GitHub Actions workflows are declared; ${summary.scheduledWorkflowCount} currently have scheduled triggers. Manual dispatch remains available where the workflow declares it.</p><table><thead><tr><th>Workflow</th><th>File</th><th>Scheduled</th><th>Manual run</th></tr></thead><tbody>${workflowRows}</tbody></table></section>
<section class="panel"><h2>How to read the KPIs</h2><p class="note"><b>Core-ready</b> means the required place and civic files exist. Optional supplement, journey, and cached-weather references are reported separately. <b>Registered</b> means an account or product receipt exists. <b>Configured</b> means a governed definition exists—not that credentials work or a fetch succeeded. <b>Healthy</b> requires a dated redacted probe. <b>Producing</b> requires an import manifest or equivalent output evidence. <b>Review backlog</b> is discovery-only and never publishes automatically. Record counts measure package depth, not geographic completeness.</p><p>Rebuild with <code>cd motherbird &amp;&amp; npm run build</code>. The generator re-reads regional configs, CITIES mappings, packaged artifacts, endpoint registrations, and the review backlog.</p></section>
<footer><a href="../">← Mother Bird</a> · <a href="./enrichment.html">POI enrichment KPI →</a> · Generated from repository sources</footer></main><script>const q=document.querySelector('#sourceSearch'),p=document.querySelector('#providerFilter'),rows=[...document.querySelectorAll('#sourceTable tbody tr')],empty=document.querySelector('#sourceEmpty'),gapFilter=document.querySelector('#gapFilter'),gapRows=[...document.querySelectorAll('#gapTable tbody tr')];function filter(){const needle=q.value.trim().toLowerCase(),provider=p.value.toLowerCase();let shown=0;for(const row of rows){const ok=(!needle||row.textContent.toLowerCase().includes(needle))&&(!provider||row.children[2].textContent.toLowerCase()===provider);row.hidden=!ok;if(ok)shown++}empty.hidden=shown>0}function filterGaps(){for(const row of gapRows)row.hidden=Boolean(gapFilter.value)&&row.children[0].textContent.trim()!==gapFilter.value}q.addEventListener('input',filter);p.addEventListener('change',filter);gapFilter.addEventListener('change',filterGaps);const authStatus=document.querySelector('#operatorAuthStatus'),controls=document.querySelector('#operatorControls'),passkey=document.querySelector('#operatorPasskey'),approvalTable='kpi_operator_approvals',packageApprovalTable='acquisition_package_approvals',packageSelectionTable='acquisition_package_selections',sourceProposalApprovalTable='acquisition_source_proposals',allowedHashes=['92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e','781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'];let client;async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,'0')).join('')}async function authorized(user){const email=String(user?.email||'').trim().toLowerCase(),phone=String(user?.phone||'').replace(/\D/g,'');return allowedHashes.includes(await digest(email))||allowedHashes.includes(await digest(phone))}async function loadApprovals(){const result=await client.from(approvalTable).select('source_id,approved');if(result.error){authStatus.textContent='Signed in, but approvals are not configured';authStatus.className='pill bad';return{}}return Object.fromEntries((result.data||[]).map((row)=>[row.source_id,row.approved]))}async function renderPackageApprovals(){const packages=await client.from(packageApprovalTable).select('package_id,approved');const selected=await client.from(packageSelectionTable).select('package_id,record_id,selected');const approvals=Object.fromEntries((packages.data||[]).map((row)=>[row.package_id,row]));const picks=Object.fromEntries((selected.data||[]).map((row)=>[row.package_id+':'+row.record_id,row.selected]));document.querySelectorAll('[data-package-approval]').forEach((box)=>{box.disabled=false;box.checked=Boolean(approvals[box.dataset.packageApproval]?.approved);box.addEventListener('change',async()=>{const user=(await client.auth.getUser()).data.user;const result=await client.from(packageApprovalTable).upsert({package_id:box.dataset.packageApproval,approved:box.checked,approval_reference:'kpi-'+new Date().toISOString(),approved_by:user.id,updated_at:new Date().toISOString()},{onConflict:'package_id'});if(result.error){box.checked=!box.checked;authStatus.textContent='Package approval save failed';authStatus.className='pill bad'}})});document.querySelectorAll('[data-package-record]').forEach((box)=>{box.disabled=false;box.checked=Boolean(picks[box.dataset.packageRecord]);box.addEventListener('change',async()=>{const user=(await client.auth.getUser()).data.user;const [packageId,recordId]=box.dataset.packageRecord.split(':');const result=await client.from(packageSelectionTable).upsert({package_id:packageId,record_id:recordId,selected:box.checked,selected_by:user.id,updated_at:new Date().toISOString()},{onConflict:'package_id,record_id'});if(result.error){box.checked=!box.checked;authStatus.textContent='Record selection save failed';authStatus.className='pill bad'}})})}async function renderSourceProposalApprovals(){const proposals=await client.from(sourceProposalApprovalTable).select('proposal_id,approved');const approvals=Object.fromEntries((proposals.data||[]).map((row)=>[row.proposal_id,row]));document.querySelectorAll('[data-source-proposal-approval]').forEach((box)=>{box.disabled=false;box.checked=Boolean(approvals[box.dataset.sourceProposalApproval]?.approved);box.addEventListener('change',async()=>{const user=(await client.auth.getUser()).data.user;const result=await client.from(sourceProposalApprovalTable).upsert({proposal_id:box.dataset.sourceProposalApproval,approved:box.checked,approval_reference:'kpi-'+new Date().toISOString(),approved_by:user.id,updated_at:new Date().toISOString()},{onConflict:'proposal_id'});if(result.error){box.checked=!box.checked;authStatus.textContent='Source proposal approval save failed';authStatus.className='pill bad'}})})}async function renderApprovals(){const saved=await loadApprovals();document.querySelectorAll('[data-approval-id]').forEach((box)=>{box.disabled=false;box.checked=Boolean(saved[box.dataset.approvalId]);box.addEventListener('change',async()=>{const result=await client.from(approvalTable).upsert({source_id:box.dataset.approvalId,approved:box.checked,approved_by:client.auth.getUser ? (await client.auth.getUser()).data.user.id : null,updated_at:new Date().toISOString()},{onConflict:'source_id'});if(result.error){box.checked=!box.checked;authStatus.textContent='Approval save failed';authStatus.className='pill bad'}})});await renderPackageApprovals();await renderSourceProposalApprovals()}async function operatorSignIn(){if(!window.supabase?.createClient||!window.WALK_WILDLIFE_SUPABASE?.url){authStatus.textContent='Supabase is not configured';return}client=window.supabase.createClient(window.WALK_WILDLIFE_SUPABASE.url,window.WALK_WILDLIFE_SUPABASE.anonKey,{auth:{experimental:{passkey:true}}});if(!client.auth.signInWithPasskey){authStatus.textContent='Passkey sign-in unavailable';return}const result=await client.auth.signInWithPasskey();if(result.error){authStatus.textContent='Sign-in failed';return}if(!await authorized(result.data?.user)){authStatus.textContent='Signed in, but this account is not a moderator';authStatus.className='pill bad';return}authStatus.textContent='Signed in as moderator';authStatus.className='pill good';controls.hidden=false;await renderApprovals()}passkey.addEventListener('click',()=>{void operatorSignIn()})</script></body></html>`;
}

export function renderEnrichmentHtml(model) {
  const regions = model.cities.map((city) => ({ id: city.cityId, name: `${city.name}, ${city.state}`, files: city.poiFiles.map((file) => `../${String(file).replace(/^\.\//, '')}`), count: city.poiCount, metadata: city.metadata }));
  const regionRows = model.cities.map((city) => `<tr><td>${escapeHtml(city.name)}, ${escapeHtml(city.state)}</td><td>${city.poiCount.toLocaleString()}</td><td><b>${city.metadata.averageCompleteness}%</b></td><td>${city.metadata.narrativeReady.toLocaleString()} · ${city.metadata.narrativeReadyRate}%</td><td>${escapeHtml(city.metadata.missing.slice(0, 3).map((item) => `${item.label} (${item.count.toLocaleString()})`).join(' · '))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>POI enrichment KPI · Gremlin Labs</title><style>:root{--ink:#17221d;--muted:#5f6d65;--paper:#f5f2e9;--card:#fffdf7;--line:#d8d2c2;--green:#287454;--mint:#dcecdf;--amber:#9b6500;--red:#9b3c2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:48px 0 24px}h1{font:700 clamp(2rem,5vw,4.3rem)/1 Georgia,serif;margin:.25rem 0 1rem}h2{font:700 1.55rem Georgia,serif}p{color:var(--muted)}a{color:var(--green)}.eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:var(--green);font-weight:800}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.card,.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 18px #203b2810}.card,.panel{padding:20px}.card b{display:block;font:700 2.3rem Georgia,serif;color:var(--green)}.panel{margin-bottom:20px;overflow:hidden}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select{min-height:42px;border:1px solid var(--line);background:white;border-radius:10px;padding:8px 12px;font:inherit}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;font-size:.88rem}th{text-align:left;color:var(--muted);font-size:.72rem;text-transform:uppercase}th,td{padding:11px 9px;border-bottom:1px solid #e5e0d4;vertical-align:top}.pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:.75rem;font-weight:700}.good{background:var(--mint);color:var(--green)}.warn{background:#f8e9c5;color:var(--amber)}.bad{background:#f7ded8;color:var(--red)}.meter{height:8px;background:#ebe7dc;border-radius:99px;overflow:hidden;min-width:90px}.meter i{display:block;height:100%;background:var(--green)}.note{border-left:4px solid var(--green);padding-left:14px}footer{padding:24px 0 50px;color:var(--muted)}@media(max-width:800px){.cards{grid-template-columns:1fr}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px 0;border-bottom:1px solid var(--line)}td{border:0;padding:4px 0}header{padding-top:28px}}</style></head><body><header><div class="eyebrow">Gremlin Labs · content operations</div><h1>POI enrichment KPI</h1><p>Measures whether every place can support a useful decision or story—not merely a map pin and “visit here.” Select a region to inspect individual records directly from its deployed package.</p><p>Generated ${escapeHtml(model.generatedAt)}. Completeness checks nine fields; it does not judge prose quality or factual truth.</p></header><main><section class="cards"><article class="card"><span>POI metadata completeness</span><b>${model.summary.averagePoiMetadata}%</b><small>weighted across deployed records</small></article><article class="card"><span>Narrative-ready POIs</span><b>${model.summary.narrativeReadyPois.toLocaleString()}</b><small>both description/story and source provenance</small></article><article class="card"><span>Explicit publishing/category fields</span><b>0%</b><small>contract migration required; inference is not counted</small></article></section><section class="panel"><h2>Region enrichment queue</h2><p>The largest missing fields are the highest-leverage producer work for each region.</p><table><thead><tr><th>Region</th><th>POIs</th><th>Completeness</th><th>Narrative ready</th><th>Largest gaps</th></tr></thead><tbody>${regionRows}</tbody></table></section><section class="panel"><h2>Inspect each POI</h2><div class="toolbar"><select id="region">${regions.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} · ${r.count.toLocaleString()}</option>`).join('')}</select><input id="search" type="search" placeholder="Search name, category, id, or missing field…"></div><p id="status">Choose a region to load its deployed POI metadata.</p><table><thead><tr><th>Place</th><th>Category</th><th>Metadata</th><th>Missing enrichment</th><th>Source</th></tr></thead><tbody id="poiRows"></tbody></table></section><section class="panel"><h2>Metric contract</h2><p class="note"><b>Narrative-ready</b> means the record has descriptive context and source provenance. <b>Completeness</b> checks description/story, provenance, official link, hours, accessibility, amenities, review evidence, explicit publishing state, and explicit Discover category. Missing data is a producer backlog signal—not permission to fabricate it. Matching should use stable source IDs, authoritative URLs, spatial proximity, and normalized names, with ambiguous joins held for review.</p></section><footer><a href="./">← Data & capability index</a> · <a href="../">Mother Bird</a></footer></main><script>const regions=${JSON.stringify(regions).replace(/</g, '\\u003c')};const fieldLabels={description:'Description/story',source:'Source provenance',website:'Official link',hours:'Hours',accessibility:'Accessibility',amenities:'Amenities',review:'Review evidence',publishingState:'Publishing state',discoverCategory:'Discover category'};let records=[];const meaningful=v=>v!==null&&v!==undefined&&v!==''&&v!=='N/A'&&(!Array.isArray(v)||v.length>0)&&(typeof v!=='object'||Array.isArray(v)||Object.values(v).some(meaningful));function metric(p){const v={description:p.description||p.story||p.context||p.historyText,source:p.source,website:p.website||p.link||p.officialUrl,hours:p.hours||p.openingHours,accessibility:p.accessibility||p.wheelchair,amenities:p.amenities||[p.restrooms&&'restrooms',p.parking&&'parking',p.drinkingWater&&'water'].filter(Boolean),review:p.review?.validationStatus||p.editorial_status,publishingState:p.publishingState,discoverCategory:p.discoverCategory};const missing=Object.keys(v).filter(k=>!meaningful(v[k]));return{missing,score:Math.round((9-missing.length)/9*100)}}function sources(p){const a=Array.isArray(p.source)?p.source:[p.source];return a.filter(Boolean).map(s=>typeof s==='string'?s:(s.name||s.url||'Source')).join(', ')||'Missing'}function render(){const q=document.querySelector('#search').value.trim().toLowerCase();const shown=records.filter(p=>{const m=metric(p);return !q||[p.name,p.id,p.category,...m.missing.map(k=>fieldLabels[k])].join(' ').toLowerCase().includes(q)}).slice(0,250);document.querySelector('#poiRows').innerHTML=shown.map(p=>{const m=metric(p);const cls=m.score>=70?'good':m.score>=40?'warn':'bad';return '<tr><td><b>'+esc(p.name||'Unnamed')+'</b><br><small>'+esc(p.id||'No stable id')+'</small></td><td>'+esc(p.category||'Missing')+'</td><td><span class="pill '+cls+'">'+m.score+'%</span><div class="meter"><i style="width:'+m.score+'%"></i></div></td><td>'+esc(m.missing.map(k=>fieldLabels[k]).join(' · ')||'None')+'</td><td>'+esc(sources(p))+'</td></tr>'}).join('');document.querySelector('#status').textContent='Showing '+shown.length+' of '+records.length+' records'+(records.length>250?' (first 250; search to narrow)':'')+'.'}async function load(){const r=regions.find(x=>x.id===document.querySelector('#region').value);document.querySelector('#status').textContent='Loading '+r.name+'…';const payloads=await Promise.all(r.files.map(f=>fetch(f).then(x=>x.ok?x.json():null).catch(()=>null)));records=payloads.flatMap(p=>p?.pois||p?.pointsOfInterest||[]);render()}const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));document.querySelector('#region').addEventListener('change',load);document.querySelector('#search').addEventListener('input',render);load();</script></body></html>`;
}

export function renderSourceAtlasHtml(model) {
  const sourceRows = model.sources.map((source) => `<article class="source-card" data-search="${escapeHtml([source.regionName, source.name, source.provider, source.domains.join(' '), source.frontend].join(' '))}">
    <div class="source-pin"><span>${source.provider === 'OpenStreetMap' || /osm|openstreetmap/i.test(source.name) ? '◎' : '◈'}</span></div>
    <div class="source-copy"><div class="eyebrow">${escapeHtml(source.provider)} · ${escapeHtml(source.regionName)}</div><h2>${escapeHtml(source.name)}</h2><p>${escapeHtml(source.domains.join(' · '))}</p><dl><dt>Feeds</dt><dd>${escapeHtml(source.frontend || 'Repository source')}</dd><dt>Evidence</dt><dd>${escapeHtml(source.credential === 'none' ? 'Public source · no credential' : `Credentialed producer · ${source.credential}`)}</dd></dl><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">Open source record ↗</a></div>
  </article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gremlin Labs · Source Atlas</title><style>
  :root{--ink:#17221d;--muted:#657169;--paper:#f3efe3;--card:#fffdf7;--line:#d8d2c2;--green:#287454;--mint:#dcecdf;--amber:#a46700}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}header,main,footer{width:min(1380px,calc(100% - 32px));margin:auto}header{padding:48px 0 26px}.eyebrow{color:var(--green);font-size:.72rem;font-weight:850;letter-spacing:.13em;text-transform:uppercase}h1{max-width:900px;margin:.3rem 0 1rem;font:700 clamp(2.4rem,6vw,5.4rem)/.95 Georgia,serif}h2{margin:.2rem 0;font:700 1.35rem/1.1 Georgia,serif}p{color:var(--muted)}.lede{max-width:760px;font-size:1.05rem}.legend{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}.legend span{padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:.8rem}.toolbar{display:flex;gap:10px;margin:18px 0}input{width:min(500px,100%);min-height:44px;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font:inherit;background:#fff}.atlas{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:28px 0 12px}.atlas:before{content:'';position:absolute;inset:0 0 12px;background:repeating-linear-gradient(0deg,transparent 0 38px,#d9d3c5 39px 40px),repeating-linear-gradient(90deg,transparent 0 78px,#d9d3c5 79px 80px);opacity:.45;pointer-events:none}.source-card{position:relative;display:grid;grid-template-columns:42px 1fr;gap:10px;padding:16px;background:rgba(255,253,247,.94);border:1px solid var(--line);border-radius:15px;box-shadow:0 5px 16px #203b2810}.source-pin{display:grid;place-items:start center}.source-pin span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--mint);color:var(--green);font-size:1.3rem;font-weight:900}.source-copy p{margin:.45rem 0;font-size:.8rem}.source-copy dl{display:grid;grid-template-columns:70px 1fr;gap:3px 8px;margin:12px 0;font-size:.76rem}.source-copy dt{font-weight:800;color:var(--muted)}.source-copy dd{margin:0}.source-copy a{color:var(--green);font-weight:800;font-size:.78rem}.empty{padding:30px;text-align:center;color:var(--muted)}footer{padding:26px 0 50px;color:var(--muted)}footer a{color:var(--green)}@media(max-width:900px){.atlas{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){header,main,footer{width:min(100% - 20px,1380px)}header{padding-top:28px}.atlas{grid-template-columns:1fr}.source-card{padding:14px}}
  </style></head><body><header><div class="eyebrow">Gremlin Labs · second map</div><h1>Source Atlas</h1><p class="lede">A living map of the systems behind the walking map: open data, civic records, official institutions, community mapping, and the transformations that connect them to a place.</p><div class="legend"><span>◎ Open/community source</span><span>◈ Governed source adapter</span><span>Every card keeps its evidence trail</span></div><div class="toolbar"><input id="sourceSearch" type="search" placeholder="Search OSM, civic, trails, region…"></div></header><main><section class="atlas" id="atlas">${sourceRows || '<p class="empty">No source records have been indexed yet.</p>'}</section><p id="empty" class="empty" hidden>No source records match that search.</p></main><footer><a href="../">← Mother Bird</a> · <a href="./">KPI index →</a> · <a href="./enrichment.html">POI enrichment →</a></footer><script>const input=document.querySelector('#sourceSearch'),cards=[...document.querySelectorAll('.source-card')],empty=document.querySelector('#empty');input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();let n=0;cards.forEach(card=>{const show=!q||card.dataset.search.toLowerCase().includes(q);card.hidden=!show;if(show)n++});empty.hidden=n>0})</script></body></html>`;
}

export async function buildKpiIndex(outputDirectory = resolve(motherbirdRoot, 'dist', 'kpi')) {
  const model = await collectKpiInventory();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'index.html'), renderKpiHtml(model));
  await writeFile(resolve(outputDirectory, 'enrichment.html'), renderEnrichmentHtml(model));
  await writeFile(resolve(outputDirectory, 'sources.html'), renderSourceAtlasHtml(model));
  await writeFile(resolve(outputDirectory, 'inventory.json'), JSON.stringify(model, null, 2));
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = await buildKpiIndex();
  console.log(`Built KPI index: ${model.summary.configuredEndpoints} endpoints across ${model.summary.producerRegions} producer regions.`);
}
