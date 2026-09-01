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

export async function loadCityData(cityId) {
  const config = normalizeRegionDataConfig(cityId, CITIES[cityId]);
  const saved = (await db.all('points_of_interest')).filter((poi) => poi.city === cityId);
  const metadata = await db.get('poi_metadata', `${cityId}-seed`);
  const response = await fetch(config.dataFile);
  if (!response.ok) throw new Error(`${cityLabel(cityId)} places data could not be loaded.`);
  const seed = await response.json();
  let edgeSegments = [];
  if (config.edgeFile) {
    try {
      const edgeResponse = await fetch(config.edgeFile);
      if (edgeResponse.ok) {
        const edgePackage = await edgeResponse.json();
        edgeSegments = (edgePackage.edges || []).flatMap((edge) => {
          const geometry = edge.geometry || {};
          const coordinates = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
          return coordinates.length ? [{ id: edge.id, name: edge.name || 'Named trail', coordinates, source: edge.source || [] }] : [];
        });
      }
    } catch { edgeSegments = []; }
  }
  let supplements = [];
  const supplementFiles = [...(config.supplementalPoiFiles || []), config.journeyFile, config.osm?.enabled ? config.osm.packageFile : null].filter(Boolean);
  if (supplementFiles.length) {
    const packages = await Promise.all(supplementFiles.map(async (file) => {
      try {
        const supplementResponse = await fetch(file);
        return supplementResponse.ok ? await supplementResponse.json() : null;
      } catch { return null; }
    }));
    supplements = packages.flatMap((pack) => {
      if (pack?.journeys?.length) return pack.journeys.filter(validJourney).map((journey) => ({ ...journey, category: 'journey', type: 'journey' }));
      return pack?.pois || pack?.pointsOfInterest || [];
    });
  }
  function validJourney(journey) {
    const coordinates = (journey.chapters || []).flatMap((chapter) => chapter.geometry?.coordinates || []);
    return coordinates.length >= 2 && coordinates.every(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0));
  }
  const mergeSupplements = (pois) => {
    const byId = new Map(pois.map((poi) => [poi.id, poi]));
    supplements.forEach((poi) => byId.set(poi.id, poi));
    return [...byId.values()];
  };
  const seedVersion = seed.generatedAt || seed.metadata?.generatedAt || seed.metadata?.version || seed.schemaVersion || 1;
  const seedAttribution = seed.metadata?.attribution || seed.producer?.name || 'Gremlin Lab';

  if (!metadata || metadata.version !== seedVersion || !saved.length) {
    const newPois = mergeSupplements(seed.pois || seed.pointsOfInterest || []).filter((poi) => poi.category !== 'journey' || validJourney(poi)).map((poi) => migratePoi(poi, cityId));
    await Promise.all(newPois.map((item) => db.put('points_of_interest', item)));
    const nextIds = new Set(newPois.map((poi) => poi.id));
    await Promise.all(saved.filter((poi) => !nextIds.has(poi.id)).map((poi) => db.remove('points_of_interest', poi.id)));
    await db.put('poi_metadata', { id: `${cityId}-seed`, version: seedVersion, attribution: seedAttribution, trailSegments: edgeSegments.length ? edgeSegments : (seed.trailSegments || []) });
    state.cityPois[cityId] = newPois;
    state.trailSegments[cityId] = edgeSegments.length ? edgeSegments : (seed.trailSegments || []);
  } else {
    const invalidJourneyIds = saved.filter((poi) => poi.category === 'journey' && !validJourney(poi)).map((poi) => poi.id);
    await Promise.all(invalidJourneyIds.map((id) => db.remove('points_of_interest', id)));
    const merged = mergeSupplements(saved.filter((poi) => !invalidJourneyIds.includes(poi.id))).filter((poi) => poi.category !== 'journey' || validJourney(poi)).map((poi) => migratePoi(poi, cityId));
    const existing = new Set(saved.map((poi) => poi.id));
    const additions = merged.filter((poi) => !existing.has(poi.id));
    if (additions.length) await Promise.all(additions.map((poi) => db.put('points_of_interest', poi)));
    state.cityPois[cityId] = merged;
    state.trailSegments[cityId] = edgeSegments.length ? edgeSegments : (metadata.trailSegments || []);
  }
}
export async function loadAllCityData() {
  // Loading every regional seed at boot made first paint especially expensive
  // for the NYC historical-sign dataset. Load the active/nearest edition now;
  // switchCity loads another city only when a person selects it.
  await loadCityData(state.activeCity);
}
export async function refreshCityMap(recenter = false) {
  const active = cityLookup();
  state.observationLayer.clearLayers(); state.prompted.clear();
  const observations = await db.all('observations');
  observations.filter((observation) => localObservationCity(observation) === state.activeCity).forEach(addObservationMarker);
  if (recenter) state.map.setView([active.center.lat, active.center.lng], active.zoom);
  el('activeCityLabel').textContent = CITIES[state.activeCity]?.name || cityLabel(state.activeCity);
  el('map').setAttribute('aria-label', `Map of ${cityLabel(state.activeCity)} installed-pack places`);
  renderCityExplorer(); renderCityPois();
  await loadNeighborhoodsForCity(state.activeCity);
  void renderWeatherBrief();
  renderProfile();
}
export async function switchCity(nextCity, recenter = true) {
  if (!CITIES[nextCity]) return;
  if (state.activeWalk) { toast('Finish the current walk before switching regions.'); return; }
  state.activeCity = nextCity; state.settings.activeCity = nextCity;
  if (!state.cityPois[nextCity]) await loadCityData(nextCity);
  state.curatedRouteLine?.remove(); state.curatedRouteLine = null;
  state.plannedRouteLine?.remove(); state.plannedRouteLines?.forEach((line) => line.remove()); state.plannedRouteLine = null; state.plannedRouteLines = []; state.plannedRoute = null;
  state.poiTags.clear();
  await db.put('settings', state.settings);
  await refreshCityMap(recenter);
  window.dispatchEvent(new CustomEvent('city-layer-data-changed'));
  setStatus(`${cityLabel(nextCity)} ready for a walk`);
  toast(`Now exploring ${cityLabel(nextCity)}.`);
}
