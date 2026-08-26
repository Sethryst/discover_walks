import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';
import { DISCOVER_GROUPS, discoverGroupFor, publishingState } from '../js/discovery-taxonomy.js';
import { FIELD_GUIDE_SUBJECTS } from '../js/field-guide.js';

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
    const localTags = new Set(city.experience.tags);
    city.experience.guideSubjects = FIELD_GUIDE_SUBJECTS.filter((subject) => subject.relatedTags.some((tag) => localTags.has(tag))).map(({ id, group, name, sourceName }) => ({ id, group, name, sourceName }));
    city.experience.guideSubjectCount = city.experience.guideSubjects.length;
    city.experience.discoverReady = city.experience.publishedCount >= 24 && city.experience.nonemptyCategoryCount >= 2;
    city.experience.guideReady = city.experience.guideSubjectCount >= 3;
    city.experience.launchStatus = city.experience.discoverReady && city.experience.guideReady ? 'Launch-ready' : city.experience.total > 0 ? 'Thin' : 'Content-blocked';
  }

  const backlog = await readJson(resolve(repoRoot, 'expansion-queues', 'regional-source-backlog.json'), {});
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
    { capability: 'Field Guide', status: 'Foundation shipped', evidence: `${FIELD_GUIDE_SUBJECTS.length} source-backed educational subjects`, frontend: 'Guide mode', next: 'Generate reviewed regional and seasonal guide packages' },
    { capability: 'Journal', status: 'Shipped', evidence: 'Personal walks · observations · reflections · remembered places', frontend: 'Journal mode + local IndexedDB', next: 'Add collections and subject references without syncing private content' },
    { capability: 'Regional source backlog', status: 'Automated', evidence: `${Number(backlog?.summary?.candidateCount || 0)} candidates across ${Number(backlog?.summary?.regionCount || 0)} regions`, frontend: 'KPI operator queue', next: 'Promote passing official structured sources through review gates' },
    { capability: 'Pages inventory', status: 'Automated', evidence: 'Rebuilt from CITIES, artifacts, configs, endpoints, workflows, and UI contracts', frontend: '/kpi/', next: 'Add live endpoint health and freshness history' },
    { capability: 'Federal region progress', status: federalProgressReady ? 'Shipped · local-first' : 'Awaiting tagged POIs', evidence: federalProgressReady ? `${federalTaggedPois.toLocaleString()} tagged POIs · ${federalProgressRegions} federal regions · ${federalPoiProgress.congress}th Congress` : 'Canonical POI tag index is missing or empty', frontend: 'Map → Boundaries region readout', next: 'Re-run federal POI tagging after a POI refresh or Congress rollover' },
    { capability: 'DC spatial solo pilot', status: spatialSync.deploymentReady ? 'Package ready · transport off' : 'Identity blocked', evidence: `${spatialSync.poiCount.toLocaleString()} POIs · ${spatialSync.boundaryCount} boundaries · ${spatialSync.poiVersion || 'missing POI version'}`, frontend: 'Authenticated DC map closure control', next: 'Enable county transport only after a separately approved tenant deployment' },
    { capability: 'Google sign-in', status: 'Code ready', evidence: 'Supabase OAuth redirect contains no password or client secret', frontend: 'Journal → Go Online', next: 'Enable Google provider in Supabase and Google Cloud' }
  ];

  return {
    generatedAt: new Date().toISOString(), cities, configs: configs.map(({ id, name }) => ({ id, name })), sources, providers, gaps, automationJobs, productCapabilities, spatialSync,
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
      fieldGuideSubjects: FIELD_GUIDE_SUBJECTS.length,
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
  const cards = [
    ['Experience modes', summary.experienceModes, `${summary.discoverCategories} Discover categories · ${summary.fieldGuideSubjects} Guide subjects`],
    ['Core-ready regions', summary.coreReadyRegions, `of ${summary.selectableRegions} selectable regions load required place + civic packages`],
    ['Average readiness', `${summary.averageReadiness}%`, 'Places 30 · civic 20 · walks 20 · producer 20 · conditions 10'],
    ['Producer regions', summary.producerRegions, 'Governed region source configurations'],
    ['Configured endpoints', summary.configuredEndpoints, `${summary.credentialedEndpoints} require a named Actions secret`],
    ['Registered accounts', summary.registeredAccounts, `${summary.registeredConfigured} configured · ${summary.registeredHealthy} health-verified · ${summary.registeredProducing} producing`],
    ['DC spatial package', summary.spatialIndexedPois.toLocaleString(), summary.spatialSyncReady ? 'Identity approved · local-only sync transport' : 'Identity needs approval'],
    ['Review backlog', summary.backlogCandidates, `${summary.readyBacklog} classified READY`],
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gremlin Labs data & capability index</title>
<style>:root{--ink:#17221d;--muted:#5f6d65;--paper:#f5f2e9;--card:#fffdf7;--line:#d8d2c2;--green:#287454;--mint:#dcecdf;--amber:#9b6500;--red:#9b3c2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:48px 0 24px}h1{font:700 clamp(2rem,5vw,4.4rem)/.98 Georgia,serif;max-width:900px;margin:.25rem 0 1rem}h2{font:700 1.55rem Georgia,serif;margin:0 0 .35rem}p{color:var(--muted)}.eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:var(--green);font-weight:800}.updated{font-size:.85rem}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:24px 0}.card,.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 18px #203b2810}.card{padding:18px}.card b{display:block;font:700 2.2rem Georgia,serif;color:var(--green)}.card small{color:var(--muted)}.panel{padding:22px;margin:0 0 20px;overflow:hidden}.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:28px;margin-top:18px}.flow div{background:var(--mint);padding:14px;border-radius:12px;position:relative}.flow div:not(:last-child):after{content:'→';position:absolute;right:-22px;top:30%;font-weight:800;color:var(--green)}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select{min-height:42px;border:1px solid var(--line);background:white;border-radius:10px;padding:8px 12px;font:inherit}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;font-size:.88rem}th{text-align:left;color:var(--muted);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}th,td{padding:11px 9px;border-bottom:1px solid #e5e0d4;vertical-align:top}a{color:var(--green)}.pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:.75rem;font-weight:700}.good{background:var(--mint);color:var(--green)}.warn{background:#f8e9c5;color:var(--amber)}.bad{background:#f7ded8;color:var(--red)}.score{height:7px;width:90px;background:#ebe7dc;border-radius:99px;overflow:hidden;margin-bottom:4px}.score span{display:block;height:100%;background:var(--green)}.bar-row{display:grid;grid-template-columns:190px 1fr 35px;gap:10px;align-items:center;margin:9px 0}.bar{height:12px;background:#ebe7dc;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--green);border-radius:99px}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.note{border-left:4px solid var(--green);padding-left:14px}.empty{padding:24px;text-align:center;color:var(--muted)}footer{padding:24px 0 50px;color:var(--muted)}@media(max-width:1100px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.flow,.two{grid-template-columns:1fr}.flow div:not(:last-child):after{content:'↓';right:50%;top:auto;bottom:-26px}}@media(max-width:650px){header,main{width:min(100% - 20px,1440px)}header{padding-top:28px}.cards{grid-template-columns:1fr 1fr}.card{padding:14px}.card b{font-size:1.8rem}.panel{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px 0;border-bottom:1px solid var(--line)}td{border:0;padding:4px 0 4px 42%}td:before{content:attr(data-label);float:left;margin-left:-72%;width:68%;color:var(--muted);font-size:.72rem;text-transform:uppercase}.bar-row{grid-template-columns:120px 1fr 28px}}</style></head><body>
<header><div class="eyebrow">Gremlin Labs · operator dashboard</div><h1>Data & capability index</h1><p>One repository-backed view of what Mother Bird can show, where the data originates, how it is transformed, and what is not connected yet.</p><p class="updated">Generated ${escapeHtml(model.generatedAt)} during the Pages build. Counts describe repository state—not a claim of geographic completeness.</p></header><main>
<section class="cards">${cards.map(([label,value,note])=>`<article class="card"><span>${escapeHtml(label)}</span><b>${value}</b><small>${escapeHtml(note)}</small></article>`).join('')}</section>
<section class="panel"><h2>How data reaches a walker</h2><p>Secrets stay in scheduled producer jobs. Published browser assets contain reviewed outputs, never credential values.</p><div class="flow"><div><b>Official source</b><br><small>ArcGIS, APIs, RSS/ICS, open data</small></div><div><b>Provider adapter</b><br><small>Fetch, normalize, validate</small></div><div><b>Governed artifact</b><br><small>Attribution, stable IDs, freshness</small></div><div><b>Mother Bird package</b><br><small>POIs, journeys, civic, conditions</small></div><div><b>Frontend view</b><br><small>Map, Walks, Vote, Volunteer, Events</small></div></div></section>
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
<footer><a href="../">← Mother Bird</a> · <a href="./enrichment.html">POI enrichment KPI →</a> · Generated from repository sources</footer></main><script>const q=document.querySelector('#sourceSearch'),p=document.querySelector('#providerFilter'),rows=[...document.querySelectorAll('#sourceTable tbody tr')],empty=document.querySelector('#sourceEmpty'),gapFilter=document.querySelector('#gapFilter'),gapRows=[...document.querySelectorAll('#gapTable tbody tr')];function filter(){const needle=q.value.trim().toLowerCase(),provider=p.value.toLowerCase();let shown=0;for(const row of rows){const ok=(!needle||row.textContent.toLowerCase().includes(needle))&&(!provider||row.children[2].textContent.toLowerCase()===provider);row.hidden=!ok;if(ok)shown++}empty.hidden=shown>0}function filterGaps(){for(const row of gapRows)row.hidden=Boolean(gapFilter.value)&&row.children[0].textContent.trim()!==gapFilter.value}q.addEventListener('input',filter);p.addEventListener('change',filter);gapFilter.addEventListener('change',filterGaps)</script></body></html>`;
}

export function renderEnrichmentHtml(model) {
  const regions = model.cities.map((city) => ({ id: city.cityId, name: `${city.name}, ${city.state}`, files: city.poiFiles.map((file) => `../${String(file).replace(/^\.\//, '')}`), count: city.poiCount, metadata: city.metadata }));
  const regionRows = model.cities.map((city) => `<tr><td>${escapeHtml(city.name)}, ${escapeHtml(city.state)}</td><td>${city.poiCount.toLocaleString()}</td><td><b>${city.metadata.averageCompleteness}%</b></td><td>${city.metadata.narrativeReady.toLocaleString()} · ${city.metadata.narrativeReadyRate}%</td><td>${escapeHtml(city.metadata.missing.slice(0, 3).map((item) => `${item.label} (${item.count.toLocaleString()})`).join(' · '))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>POI enrichment KPI · Gremlin Labs</title><style>:root{--ink:#17221d;--muted:#5f6d65;--paper:#f5f2e9;--card:#fffdf7;--line:#d8d2c2;--green:#287454;--mint:#dcecdf;--amber:#9b6500;--red:#9b3c2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:48px 0 24px}h1{font:700 clamp(2rem,5vw,4.3rem)/1 Georgia,serif;margin:.25rem 0 1rem}h2{font:700 1.55rem Georgia,serif}p{color:var(--muted)}a{color:var(--green)}.eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:var(--green);font-weight:800}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.card,.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 18px #203b2810}.card,.panel{padding:20px}.card b{display:block;font:700 2.3rem Georgia,serif;color:var(--green)}.panel{margin-bottom:20px;overflow:hidden}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select{min-height:42px;border:1px solid var(--line);background:white;border-radius:10px;padding:8px 12px;font:inherit}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;font-size:.88rem}th{text-align:left;color:var(--muted);font-size:.72rem;text-transform:uppercase}th,td{padding:11px 9px;border-bottom:1px solid #e5e0d4;vertical-align:top}.pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:.75rem;font-weight:700}.good{background:var(--mint);color:var(--green)}.warn{background:#f8e9c5;color:var(--amber)}.bad{background:#f7ded8;color:var(--red)}.meter{height:8px;background:#ebe7dc;border-radius:99px;overflow:hidden;min-width:90px}.meter i{display:block;height:100%;background:var(--green)}.note{border-left:4px solid var(--green);padding-left:14px}footer{padding:24px 0 50px;color:var(--muted)}@media(max-width:800px){.cards{grid-template-columns:1fr}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px 0;border-bottom:1px solid var(--line)}td{border:0;padding:4px 0}header{padding-top:28px}}</style></head><body><header><div class="eyebrow">Gremlin Labs · content operations</div><h1>POI enrichment KPI</h1><p>Measures whether every place can support a useful decision or story—not merely a map pin and “visit here.” Select a region to inspect individual records directly from its deployed package.</p><p>Generated ${escapeHtml(model.generatedAt)}. Completeness checks nine fields; it does not judge prose quality or factual truth.</p></header><main><section class="cards"><article class="card"><span>POI metadata completeness</span><b>${model.summary.averagePoiMetadata}%</b><small>weighted across deployed records</small></article><article class="card"><span>Narrative-ready POIs</span><b>${model.summary.narrativeReadyPois.toLocaleString()}</b><small>both description/story and source provenance</small></article><article class="card"><span>Explicit publishing/category fields</span><b>0%</b><small>contract migration required; inference is not counted</small></article></section><section class="panel"><h2>Region enrichment queue</h2><p>The largest missing fields are the highest-leverage producer work for each region.</p><table><thead><tr><th>Region</th><th>POIs</th><th>Completeness</th><th>Narrative ready</th><th>Largest gaps</th></tr></thead><tbody>${regionRows}</tbody></table></section><section class="panel"><h2>Inspect each POI</h2><div class="toolbar"><select id="region">${regions.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} · ${r.count.toLocaleString()}</option>`).join('')}</select><input id="search" type="search" placeholder="Search name, category, id, or missing field…"></div><p id="status">Choose a region to load its deployed POI metadata.</p><table><thead><tr><th>Place</th><th>Category</th><th>Metadata</th><th>Missing enrichment</th><th>Source</th></tr></thead><tbody id="poiRows"></tbody></table></section><section class="panel"><h2>Metric contract</h2><p class="note"><b>Narrative-ready</b> means the record has descriptive context and source provenance. <b>Completeness</b> checks description/story, provenance, official link, hours, accessibility, amenities, review evidence, explicit publishing state, and explicit Discover category. Missing data is a producer backlog signal—not permission to fabricate it. Matching should use stable source IDs, authoritative URLs, spatial proximity, and normalized names, with ambiguous joins held for review.</p></section><footer><a href="./">← Data & capability index</a> · <a href="../">Mother Bird</a></footer></main><script>const regions=${JSON.stringify(regions).replace(/</g, '\\u003c')};const fieldLabels={description:'Description/story',source:'Source provenance',website:'Official link',hours:'Hours',accessibility:'Accessibility',amenities:'Amenities',review:'Review evidence',publishingState:'Publishing state',discoverCategory:'Discover category'};let records=[];const meaningful=v=>v!==null&&v!==undefined&&v!==''&&v!=='N/A'&&(!Array.isArray(v)||v.length>0)&&(typeof v!=='object'||Array.isArray(v)||Object.values(v).some(meaningful));function metric(p){const v={description:p.description||p.story||p.context||p.historyText,source:p.source,website:p.website||p.link||p.officialUrl,hours:p.hours||p.openingHours,accessibility:p.accessibility||p.wheelchair,amenities:p.amenities||[p.restrooms&&'restrooms',p.parking&&'parking',p.drinkingWater&&'water'].filter(Boolean),review:p.review?.validationStatus||p.editorial_status,publishingState:p.publishingState,discoverCategory:p.discoverCategory};const missing=Object.keys(v).filter(k=>!meaningful(v[k]));return{missing,score:Math.round((9-missing.length)/9*100)}}function sources(p){const a=Array.isArray(p.source)?p.source:[p.source];return a.filter(Boolean).map(s=>typeof s==='string'?s:(s.name||s.url||'Source')).join(', ')||'Missing'}function render(){const q=document.querySelector('#search').value.trim().toLowerCase();const shown=records.filter(p=>{const m=metric(p);return !q||[p.name,p.id,p.category,...m.missing.map(k=>fieldLabels[k])].join(' ').toLowerCase().includes(q)}).slice(0,250);document.querySelector('#poiRows').innerHTML=shown.map(p=>{const m=metric(p);const cls=m.score>=70?'good':m.score>=40?'warn':'bad';return '<tr><td><b>'+esc(p.name||'Unnamed')+'</b><br><small>'+esc(p.id||'No stable id')+'</small></td><td>'+esc(p.category||'Missing')+'</td><td><span class="pill '+cls+'">'+m.score+'%</span><div class="meter"><i style="width:'+m.score+'%"></i></div></td><td>'+esc(m.missing.map(k=>fieldLabels[k]).join(' · ')||'None')+'</td><td>'+esc(sources(p))+'</td></tr>'}).join('');document.querySelector('#status').textContent='Showing '+shown.length+' of '+records.length+' records'+(records.length>250?' (first 250; search to narrow)':'')+'.'}async function load(){const r=regions.find(x=>x.id===document.querySelector('#region').value);document.querySelector('#status').textContent='Loading '+r.name+'…';const payloads=await Promise.all(r.files.map(f=>fetch(f).then(x=>x.ok?x.json():null).catch(()=>null)));records=payloads.flatMap(p=>p?.pois||p?.pointsOfInterest||[]);render()}const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));document.querySelector('#region').addEventListener('change',load);document.querySelector('#search').addEventListener('input',render);load();</script></body></html>`;
}

export async function buildKpiIndex(outputDirectory = resolve(motherbirdRoot, 'dist', 'kpi')) {
  const model = await collectKpiInventory();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'index.html'), renderKpiHtml(model));
  await writeFile(resolve(outputDirectory, 'enrichment.html'), renderEnrichmentHtml(model));
  await writeFile(resolve(outputDirectory, 'inventory.json'), JSON.stringify(model, null, 2));
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = await buildKpiIndex();
  console.log(`Built KPI index: ${model.summary.configuredEndpoints} endpoints across ${model.summary.producerRegions} producer regions.`);
}
