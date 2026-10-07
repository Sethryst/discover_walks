import db from './storage.js';
import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, cityLabel, localObservationCity } from './utils.js';
import { renderCityExplorer, renderCityPois, migratePoi, city as cityLookup } from './poi.js';
import { renderProfile } from './profile.js';
import { setStatus, toast } from './ui.js';
import { addObservationMarker } from './observation.js';
import { renderWeatherBrief } from './weather.js';
import { loadNeighborhoodsForCity } from './neighborhoods.js';
import { normalizeRegionDataConfig } from './osm-regions.js';
import { activateInstalledRegionRuntime } from './installed-region-runtime.js';
import { activateCountyAdditions } from './county-additions.js';

function perfMark(name, detail = {}) {
  if (!globalThis.performance?.mark) return;
  performance.mark(name, { detail });
  if (globalThis.console?.debug) console.debug(`[motherbird:perf] ${name}`, detail);
}

function perfMeasure(name, start, detail = {}) {
  if (!globalThis.performance?.measure) return;
  try {
    const measure = performance.measure(name, start);
    if (globalThis.console?.info) console.info(`[motherbird:perf] ${name}`, { duration: Math.round(measure.duration), ...detail });
  } catch { /* instrumentation must never affect loading */ }
}

export async function loadCityData(cityId) {
  const bootStart = `city-data:${cityId}:start`;
  perfMark(bootStart, { cityId });
  const config = normalizeRegionDataConfig(cityId, CITIES[cityId]);
  const saved = (await db.all('points_of_interest')).filter((poi) => poi.city === cityId);
  const metadata = await db.get('poi_metadata', `${cityId}-seed`);
  if (globalThis.navigator?.onLine === false) {
    state.cityPois[cityId] = saved.map((poi) => migratePoi(poi, cityId));
    state.trailSegments[cityId] = metadata?.trailSegments || [];
    return;
  }
  const response = await fetch(config.dataFile);
  if (!response.ok) throw new Error(`${cityLabel(cityId)} places data could not be loaded.`);
  perfMark(`city-data:${cityId}:response`, { bytes: Number(response.headers.get('content-length')) || 0 });
  const seed = await response.json();
  perfMeasure(`city-data:${cityId}:fetch-and-parse`, bootStart, { records: (seed.pois || seed.pointsOfInterest || []).length });
  const seedVersion = seed.generatedAt || seed.metadata?.generatedAt || seed.metadata?.version || seed.schemaVersion || 1;
  const seedAttribution = seed.metadata?.attribution || seed.producer?.name || 'Gremlin Lab';
  const basePois = (seed.pois || seed.pointsOfInterest || []).map((poi) => migratePoi(poi, cityId));
  perfMark(`city-data:${cityId}:transformed`, { records: basePois.length });

  if (!metadata || metadata.version !== seedVersion || !saved.length) {
    const newPois = basePois;
    await writeInBatches('points_of_interest', newPois);
    perfMark(`city-data:${cityId}:stored`, { records: newPois.length });
    const nextIds = new Set(newPois.map((poi) => poi.id));
    await removeInBatches('points_of_interest', saved.filter((poi) => !nextIds.has(poi.id)).map((poi) => poi.id));
    await db.put('poi_metadata', { id: `${cityId}-seed`, version: seedVersion, attribution: seedAttribution, trailSegments: metadata?.trailSegments || seed.trailSegments || [] });
    state.cityPois[cityId] = newPois;
    state.trailSegments[cityId] = metadata?.trailSegments || seed.trailSegments || [];
  } else {
    state.cityPois[cityId] = saved.map((poi) => migratePoi(poi, cityId));
    state.trailSegments[cityId] = metadata.trailSegments || [];
  }
  perfMeasure(`city-data:${cityId}:complete`, bootStart, { records: state.cityPois[cityId]?.length || 0 });
}

const IDLE = globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 0));
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
async function writeInBatches(store, records, size = 100) {
  for (let offset = 0; offset < records.length; offset += size) {
    await db.putMany({ [store]: records.slice(offset, offset + size) });
    await pause();
  }
}
async function removeInBatches(store, ids, size = 100) {
  for (let offset = 0; offset < ids.length; offset += size) {
    await db.putMany({}, { [store]: ids.slice(offset, offset + size) });
    await pause();
  }
}
function validJourney(journey) {
  const coordinates = (journey.chapters || []).flatMap((chapter) => chapter.geometry?.coordinates || []);
  return coordinates.length >= 2 && coordinates.every(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0));
}
export function loadCityEnrichment(cityId = state.activeCity) {
  return new Promise((resolve) => IDLE(() => void loadCityEnrichmentNow(cityId).then(resolve).catch((error) => { console.warn('Regional enrichment unavailable:', error.message); resolve(false); })));
}
async function loadCityEnrichmentNow(cityId) {
  const enrichmentStart = `city-enrichment:${cityId}:start`;
  perfMark(enrichmentStart, { cityId });
  const config = normalizeRegionDataConfig(cityId, CITIES[cityId]);
  if (!config || state.cityEnrichmentLoaded?.[cityId] || navigator.onLine === false) return false;
  state.cityEnrichmentLoaded ||= {};
  state.cityEnrichmentLoaded[cityId] = true;
  let edgeSegments = [];
  if (config.edgeFile) {
    try {
      const response = await fetch(config.edgeFile);
      if (response.ok) {
        const pack = await response.json();
        perfMeasure(`city-enrichment:${cityId}:edges-parse`, enrichmentStart, { file: config.edgeFile, edges: (pack.edges || []).length });
        edgeSegments = (pack.edges || []).flatMap((edge) => {
          const geometry = edge.geometry || {};
          const coordinates = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
          return coordinates.length ? [{ id: edge.id, name: edge.name || 'Named trail', coordinates, source: edge.source || [] }] : [];
        });
      }
    } catch { /* an optional layer should never block the map */ }
  }
  const files = [...(config.supplementalPoiFiles || []), config.journeyFile, config.osm?.enabled ? config.osm.packageFile : null].filter(Boolean);
  let supplements = [];
  for (const file of files) {
    try {
      const response = await fetch(file);
      if (!response.ok) continue;
      const pack = await response.json();
      perfMark(`city-enrichment:${cityId}:file-parsed`, { file, records: pack?.journeys?.length || pack?.pois?.length || pack?.pointsOfInterest?.length || 0 });
      supplements.push(...(pack?.journeys?.length ? pack.journeys.filter(validJourney).map((journey) => ({ ...journey, category: 'journey', type: 'journey' })) : pack?.pois || pack?.pointsOfInterest || []));
      await pause();
    } catch { /* an optional layer should never block the map */ }
  }
  const current = state.cityPois[cityId] || [];
  const byId = new Map(current.map((poi) => [poi.id, poi]));
  supplements.forEach((poi) => byId.set(poi.id, migratePoi(poi, cityId)));
  const merged = [...byId.values()];
  const additions = merged.filter((poi) => !current.some((item) => item.id === poi.id));
  await writeInBatches('points_of_interest', additions);
  perfMark(`city-enrichment:${cityId}:stored`, { additions: additions.length, merged: merged.length, edgeSegments: edgeSegments.length });
  if (edgeSegments.length) {
    state.trailSegments[cityId] = edgeSegments;
    const metadata = await db.get('poi_metadata', `${cityId}-seed`);
    if (metadata) await db.put('poi_metadata', { ...metadata, trailSegments: edgeSegments });
  }
  state.cityPois[cityId] = merged;
  if (cityId === state.activeCity) {
    window.dispatchEvent(new CustomEvent('city-layer-data-changed'));
  }
  perfMeasure(`city-enrichment:${cityId}:complete`, enrichmentStart, { merged: merged.length, edgeSegments: edgeSegments.length });
  return true;
}
export async function loadAllCityData() {
  // Loading every regional seed at boot made first paint especially expensive
  // for the NYC historical-sign dataset. Load the active/nearest edition now;
  // switchCity loads another city only when a person selects it.
  await loadCityData(state.activeCity);
}
export async function refreshCityMap(recenter = false) {
  const active = cityLookup();
  state.observationLayer.clearLayers(); state.prompted.clear(); state.contextQuotePrompted.clear();
  const observations = await db.all('observations');
  observations.filter((observation) => localObservationCity(observation) === state.activeCity).forEach(addObservationMarker);
  if (recenter) state.map.setView([active.center.lat, active.center.lng], active.zoom);
  if (el('activeCityLabel')) el('activeCityLabel').textContent = CITIES[state.activeCity]?.name || cityLabel(state.activeCity);
  el('map').setAttribute('aria-label', `Map of ${cityLabel(state.activeCity)} installed-pack places`);
  renderCityExplorer(); renderCityPois();
  await loadNeighborhoodsForCity(state.activeCity);
  void renderWeatherBrief();
  renderProfile();
}
export async function switchCity(nextCity, recenter = true, { source = 'user' } = {}) {
  if (!CITIES[nextCity]) return;
  const recordingWalk = state.activeWalk?.recordingStatus === 'recording';
  if (state.activeWalk && !recordingWalk) { toast('Finish the current walk before switching regions.'); return; }
  if (recordingWalk && source === 'gps' && state.activeWalk.packOverride) return;
  if (nextCity === state.activeCity) {
    if (recordingWalk && source === 'user') {
      state.activeWalk.packOverride = nextCity;
      toast(`${cityLabel(nextCity)} is locked for this walk.`);
    }
    return;
  }
  const manuallyLocked = recordingWalk && source === 'user';
  if (manuallyLocked) state.activeWalk.packOverride = nextCity;
  state.activeCity = nextCity; state.settings.activeCity = nextCity;
  if (!state.cityPois[nextCity]) await loadCityData(nextCity);
  await activateInstalledRegionRuntime(nextCity);
  await activateCountyAdditions(nextCity);
  state.curatedRouteLine?.remove(); state.curatedRouteLine = null;
  state.plannedRouteLine?.remove(); state.plannedRouteLines?.forEach((line) => line.remove()); state.plannedRouteLine = null; state.plannedRouteLines = []; state.plannedRoute = null;
  state.poiTags.clear();
  await db.put('settings', state.settings);
  await refreshCityMap(recenter);
  const regionLabel = cityLabel(nextCity);
  const search = document.getElementById('mapSearchInput');
  if (search) {
    search.placeholder = 'Search';
    if (!search.value.trim() || /^Search /.test(search.value)) search.value = '';
  }
  const drawLabel = document.getElementById('drawRegionLabel');
  if (drawLabel) drawLabel.textContent = regionLabel;
  window.dispatchEvent(new CustomEvent('viewport-region-changed', { detail: { label: regionLabel, regionId: nextCity } }));
  window.dispatchEvent(new CustomEvent('city-layer-data-changed'));
  setStatus(manuallyLocked ? `${cityLabel(nextCity)} locked for this walk` : `${cityLabel(nextCity)} ready for a walk`);
  toast(manuallyLocked ? `Now exploring ${cityLabel(nextCity)}. GPS pack switching is locked for this walk.` : `Now exploring ${cityLabel(nextCity)}.`);
}
