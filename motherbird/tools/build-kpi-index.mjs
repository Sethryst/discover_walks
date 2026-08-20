import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const motherbirdRoot = resolve(here, '..');
const repoRoot = resolve(motherbirdRoot, '..');

const CITY_REGION_IDS = {
  vienna: 'wolf-trap-va', norfolk: 'norfolk', newyork: 'nyc', philadelphia: 'philadelphia',
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

  const cities = [];
  for (const [cityId, city] of Object.entries(CITIES)) {
    const data = await readJson(appPath(city.dataFile));
    const supplemental = await readJson(appPath(city.supplementalPoiFile));
    const journeys = await readJson(appPath(city.journeyFile));
    const civic = await readJson(appPath(city.civicFile));
    const requiredFiles = [city.dataFile, city.civicFile].filter(Boolean);
    const optionalFiles = [city.supplementalPoiFile, city.journeyFile, city.weatherFile].filter(Boolean);
    const missingRequiredFiles = [];
    const missingOptionalFiles = [];
    for (const file of requiredFiles) if (!(await exists(appPath(file)))) missingRequiredFiles.push(file);
    for (const file of optionalFiles) if (!(await exists(appPath(file)))) missingOptionalFiles.push(file);
    const regionId = CITY_REGION_IDS[cityId] || cityId;
    const configuredSources = sources.filter((source) => source.regionId === regionId).length;
    const poiCount = countPoiRecords(data) + countPoiRecords(supplemental);
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
  }
  cities.sort((a, b) => a.name.localeCompare(b.name));

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
    }))
  ].sort((a, b) => a.priority.localeCompare(b.priority) || a.region.localeCompare(b.region));

  const providers = Object.entries(sources.reduce((counts, source) => {
    counts[source.provider] = (counts[source.provider] || 0) + 1; return counts;
  }, {})).map(([provider, count]) => ({ provider, count })).sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(), cities, configs: configs.map(({ id, name }) => ({ id, name })), sources, providers, gaps,
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
      credentialedEndpoints: sources.filter((source) => source.credential !== 'none').length,
      coreReadyRegions: cities.filter((city) => city.missingRequiredFiles.length === 0).length,
      fullyReferencedRegions: cities.filter((city) => city.missingRequiredFiles.length === 0 && city.missingOptionalFiles.length === 0).length,
      averageReadiness: Math.round(cities.reduce((sum, city) => sum + city.readinessScore, 0) / Math.max(cities.length, 1)),
      backlogCandidates: Number(backlog?.summary?.candidateCount || 0),
      readyBacklog: Number(backlog?.summary?.classifications?.READY || 0),
      gaps: gaps.length,
      p0Gaps: gaps.filter((gap) => gap.priority === 'P0').length,
      p1Gaps: gaps.filter((gap) => gap.priority === 'P1').length
    }
  };
}

function renderRows(rows, columns) {
  return rows.map((row) => `<tr>${columns.map((column) => `<td data-label="${escapeHtml(column.label)}">${column.render ? column.render(row) : escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('');
}

export function renderKpiHtml(model) {
  const { summary } = model;
  const cards = [
    ['Core-ready regions', summary.coreReadyRegions, `of ${summary.selectableRegions} selectable regions load required place + civic packages`],
    ['Average readiness', `${summary.averageReadiness}%`, 'Places 30 · civic 20 · walks 20 · producer 20 · conditions 10'],
    ['Producer regions', summary.producerRegions, 'Governed region source configurations'],
    ['Configured endpoints', summary.configuredEndpoints, `${summary.credentialedEndpoints} require a named Actions secret`],
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
  const providerBars = model.providers.slice(0, 10).map(({ provider, count }) => `<div class="bar-row"><span>${escapeHtml(provider)}</span><div class="bar"><i style="width:${Math.max(4, count / model.providers[0].count * 100)}%"></i></div><strong>${count}</strong></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gremlin Labs data & capability index</title>
<style>:root{--ink:#17221d;--muted:#5f6d65;--paper:#f5f2e9;--card:#fffdf7;--line:#d8d2c2;--green:#287454;--mint:#dcecdf;--amber:#9b6500;--red:#9b3c2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:48px 0 24px}h1{font:700 clamp(2rem,5vw,4.4rem)/.98 Georgia,serif;max-width:900px;margin:.25rem 0 1rem}h2{font:700 1.55rem Georgia,serif;margin:0 0 .35rem}p{color:var(--muted)}.eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:var(--green);font-weight:800}.updated{font-size:.85rem}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:24px 0}.card,.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 18px #203b2810}.card{padding:18px}.card b{display:block;font:700 2.2rem Georgia,serif;color:var(--green)}.card small{color:var(--muted)}.panel{padding:22px;margin:0 0 20px;overflow:hidden}.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:28px;margin-top:18px}.flow div{background:var(--mint);padding:14px;border-radius:12px;position:relative}.flow div:not(:last-child):after{content:'→';position:absolute;right:-22px;top:30%;font-weight:800;color:var(--green)}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select{min-height:42px;border:1px solid var(--line);background:white;border-radius:10px;padding:8px 12px;font:inherit}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;font-size:.88rem}th{text-align:left;color:var(--muted);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}th,td{padding:11px 9px;border-bottom:1px solid #e5e0d4;vertical-align:top}a{color:var(--green)}.pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:.75rem;font-weight:700}.good{background:var(--mint);color:var(--green)}.warn{background:#f8e9c5;color:var(--amber)}.bad{background:#f7ded8;color:var(--red)}.score{height:7px;width:90px;background:#ebe7dc;border-radius:99px;overflow:hidden;margin-bottom:4px}.score span{display:block;height:100%;background:var(--green)}.bar-row{display:grid;grid-template-columns:190px 1fr 35px;gap:10px;align-items:center;margin:9px 0}.bar{height:12px;background:#ebe7dc;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--green);border-radius:99px}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.note{border-left:4px solid var(--green);padding-left:14px}.empty{padding:24px;text-align:center;color:var(--muted)}footer{padding:24px 0 50px;color:var(--muted)}@media(max-width:1100px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.flow,.two{grid-template-columns:1fr}.flow div:not(:last-child):after{content:'↓';right:50%;top:auto;bottom:-26px}}@media(max-width:650px){header,main{width:min(100% - 20px,1440px)}header{padding-top:28px}.cards{grid-template-columns:1fr 1fr}.card{padding:14px}.card b{font-size:1.8rem}.panel{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px 0;border-bottom:1px solid var(--line)}td{border:0;padding:4px 0 4px 42%}td:before{content:attr(data-label);float:left;margin-left:-72%;width:68%;color:var(--muted);font-size:.72rem;text-transform:uppercase}.bar-row{grid-template-columns:120px 1fr 28px}}</style></head><body>
<header><div class="eyebrow">Gremlin Labs · operator dashboard</div><h1>Data & capability index</h1><p>One repository-backed view of what Mother Bird can show, where the data originates, how it is transformed, and what is not connected yet.</p><p class="updated">Generated ${escapeHtml(model.generatedAt)} during the Pages build. Counts describe repository state—not a claim of geographic completeness.</p></header><main>
<section class="cards">${cards.map(([label,value,note])=>`<article class="card"><span>${escapeHtml(label)}</span><b>${value}</b><small>${escapeHtml(note)}</small></article>`).join('')}</section>
<section class="panel"><h2>How data reaches a walker</h2><p>Secrets stay in scheduled producer jobs. Published browser assets contain reviewed outputs, never credential values.</p><div class="flow"><div><b>Official source</b><br><small>ArcGIS, APIs, RSS/ICS, open data</small></div><div><b>Provider adapter</b><br><small>Fetch, normalize, validate</small></div><div><b>Governed artifact</b><br><small>Attribution, stable IDs, freshness</small></div><div><b>Mother Bird package</b><br><small>POIs, journeys, civic, conditions</small></div><div><b>Frontend view</b><br><small>Map, Walks, Vote, Volunteer, Events</small></div></div></section>
<section class="panel"><h2>Regional readiness</h2><p>Counts are records the deployed app can load through <code>CITIES</code>. Readiness is a transparent product score: places 30 points, civic package 20, plotted walks 20, governed producer 20, and private region-center conditions 10.</p><div class="table-wrap"><table><thead><tr><th>App region</th><th>Places</th><th>Walks/routes</th><th>Civic items</th><th>Conditions</th><th>Producer sources</th><th>Readiness</th><th>References</th></tr></thead><tbody>${cityRows}</tbody></table></div></section>
<section class="panel"><h2>Prioritized repair queue</h2><p>P0 blocks a required app package. P1 is a stale enhancement reference or missing governed producer. P2 is usable producer work waiting for frontend packaging.</p><div class="toolbar"><select id="gapFilter"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option></select></div><table id="gapTable"><thead><tr><th>Priority</th><th>Type</th><th>Region</th><th>What is not connected</th><th>Next action</th></tr></thead><tbody>${gapRows || '<tr><td colspan="5" class="empty">No connection gaps detected.</td></tr>'}</tbody></table></section>
<section class="panel"><h2>Provider mix</h2><p>Configured source endpoints by acquisition adapter.</p>${providerBars}</section>
<section class="panel"><h2>Endpoint inventory</h2><p>Every governed geographic source in <code>app/regions</code>. Credential names identify the required GitHub Actions secret; values are never read or published.</p><div class="toolbar"><input id="sourceSearch" type="search" placeholder="Search region, source, endpoint, or frontend…"><select id="providerFilter"><option value="">All providers</option>${model.providers.map(({provider})=>`<option>${escapeHtml(provider)}</option>`).join('')}</select></div><table id="sourceTable"><thead><tr><th>Region</th><th>Source</th><th>Provider</th><th>Data</th><th>Endpoint</th><th>Credential</th><th>Frontend connection</th></tr></thead><tbody>${sourceRows}</tbody></table><p id="sourceEmpty" class="empty" hidden>No endpoints match those filters.</p></section>
<section class="panel"><h2>Live browser services</h2><p>These calls are separate from scheduled producer endpoints. They are invoked by explicit app behavior and follow the listed privacy boundary.</p><table><thead><tr><th>Service</th><th>Endpoint</th><th>When called</th><th>Frontend consumer</th><th>Privacy boundary</th></tr></thead><tbody>${runtimeRows}</tbody></table></section>
<section class="panel"><h2>How to read the KPIs</h2><p class="note"><b>Core-ready</b> means the required place and civic files exist. Optional supplement, journey, and cached-weather references are reported separately. <b>Configured endpoint</b> means a governed definition exists—not that it was fetched during this build. <b>Review backlog</b> is discovery-only and never publishes automatically. Record counts measure package depth, not geographic completeness.</p><p>Rebuild with <code>cd motherbird &amp;&amp; npm run build</code>. The generator re-reads regional configs, CITIES mappings, packaged artifacts, and the review backlog.</p></section>
<footer><a href="../">← Mother Bird</a> · Generated from repository sources</footer></main><script>const q=document.querySelector('#sourceSearch'),p=document.querySelector('#providerFilter'),rows=[...document.querySelectorAll('#sourceTable tbody tr')],empty=document.querySelector('#sourceEmpty'),gapFilter=document.querySelector('#gapFilter'),gapRows=[...document.querySelectorAll('#gapTable tbody tr')];function filter(){const needle=q.value.trim().toLowerCase(),provider=p.value.toLowerCase();let shown=0;for(const row of rows){const ok=(!needle||row.textContent.toLowerCase().includes(needle))&&(!provider||row.children[2].textContent.toLowerCase()===provider);row.hidden=!ok;if(ok)shown++}empty.hidden=shown>0}function filterGaps(){for(const row of gapRows)row.hidden=Boolean(gapFilter.value)&&row.children[0].textContent.trim()!==gapFilter.value}q.addEventListener('input',filter);p.addEventListener('change',filter);gapFilter.addEventListener('change',filterGaps)</script></body></html>`;
}

export async function buildKpiIndex(outputDirectory = resolve(motherbirdRoot, 'dist', 'kpi')) {
  const model = await collectKpiInventory();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'index.html'), renderKpiHtml(model));
  await writeFile(resolve(outputDirectory, 'inventory.json'), JSON.stringify(model, null, 2));
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = await buildKpiIndex();
  console.log(`Built KPI index: ${model.summary.configuredEndpoints} endpoints across ${model.summary.producerRegions} producer regions.`);
}
