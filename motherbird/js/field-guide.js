import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { routesForCity, showCuratedRoute } from './routes.js';
import { closeSheets, openBackpack, openSheet, toast } from './ui.js';
import { paintWalkConcept } from './planner.js';
import { routeOnFoot } from './routing.js';
import { distanceMeters } from './geo.js';
import db from './storage.js';
import { isVisiblePoi, selectImportantPois } from './poi.js';
import { placeLight, publicPlaceSource, walkerDetails } from './place-details.js';
import { installedPackBounds } from './offline-view.js';
import { isHistorySite, renderLearnHistory, setLearnView, setLearnScreen, setActiveWatershed, setBattlefieldEra, setBattlefieldYear, setBattlefieldSite, stepBattlefieldBack, setActiveLensItem, paintHistoricalTopo, stopHistoricalTopo } from './learn-history.js';
import { setPoiVisited } from './poi-visit-tracking.js';
import { addWalkWaypoint, startWalk } from './walk.js';
import { initMapsFolders, renderMapsLibrary } from './maps-folders.js';
import { listSpatialQueries, queryPrompt } from './spatial-query.js';

const FORMAT = 'walk-wildlife-plan-v1';
let selectedPlaceId = null;

async function loadJson(url, fallback) {
  if (!url) return fallback;
  try { const response = await fetch(url); return response.ok ? await response.json() : fallback; } catch { return fallback; }
}

async function guideData() {
  const city = CITIES[state.activeCity] || {};
  if (state.fieldGuideData?.city === state.activeCity) return state.fieldGuideData;
  const [discover, learn] = await Promise.all([loadJson(city.discoverFile, { cards: [] }), loadJson(city.learnFile, { cards: [] })]);
  const pois = (state.cityPois[state.activeCity] || []).filter((poi) => poi.category !== 'journey');
  const poiById = new Map(pois.map((poi) => [String(poi.id), poi]));
  const routeById = new Map(routesForCity(state.activeCity).map((route) => [String(route.id), route]));
  const discoverCards = (discover.cards || []).map((card) => {
    const stopPlaceIds = [...new Set((card.stopPlaceIds || []).map(String))].filter((id) => poiById.has(id));
    if (!stopPlaceIds.length) return null;
    const route = card.journeyId ? routeById.get(String(card.journeyId)) : null;
    return { ...card, id: String(card.id), kind: card.kind || (card.journeyId ? 'journey' : 'walk'), title: card.title || 'A walk from this pack', reason: card.reason || '', stopPlaceIds, ...(route?.coordinates?.length > 1 ? { coordinates: route.coordinates } : {}) };
  }).filter((card) => card && isPresentableRecommendation(card));
  const authoredLearn = [learn.whyCards, learn.cards, discover.whyCards].find(Array.isArray) || [];
  const learnCards = authoredLearn.map((card) => {
    const placeId = String(card.placeId || card.stopPlaceId || '');
    const poi = poiById.get(placeId);
    const source = publicSourceForPoi(poi, card);
    const why = card.why || card.whyText || card.reason || card.short;
    if (!poi || !source || !why) return null;
    return { ...card, id: String(card.id || `learn:${placeId}`), placeId, question: card.question || poi.name, short: why, officialUrl: card.officialUrl || source.url, provenance: card.provenance || { name: source.name } };
  }).filter(Boolean);
  const authoredById = new Map(learnCards.map((card) => [card.placeId, card]));
  const combined = pois.filter((poi) => isVisiblePoi(poi) && poi.name && Number.isFinite(poi.lat) && Number.isFinite(poi.lng)).flatMap((poi) => {
    const authored = authoredById.get(String(poi.id));
    const source = publicPlaceSource(poi, authored);
    if (!source) return [];
    const details = walkerDetails(poi);
    return [{ ...authored, id: authored?.id || `learn:${poi.id}`, placeId: String(poi.id), place_id: String(poi.id), light: placeLight(poi), question: authored?.question || poi.name, short: authored?.short || details.map((row) => row.text).join(' \u00b7 ') || `${poi.name} is a named stop in this pack. Open the public source for its local story and visiting details.`, officialUrl: source.url, provenance: { name: source.name || 'Public source' } }];
  });
  state.fieldGuideData = { city: state.activeCity, discover: discoverCards, learn: combined };
  return state.fieldGuideData;
}

function publicSourceForPoi(poi, authored) { return publicPlaceSource(poi, authored); }
function isPresentableRecommendation(card) {
  // Generated proximity clusters are useful internal candidates, not curated recommendations.
  if (card.kind !== 'journey' && card.curated !== true) return false;
  const copy = `${card.title || ''} ${card.reason || ''}`;
  return Boolean(card.title?.trim() && card.reason?.trim())
    && !/[+]/.test(card.title)
    && !/park\+cafe\+rest|official non-county|trail geometry|artifact_type|generated from|assembled from/i.test(copy);
}
function nearbyWalks(pois, point) {
  const candidates = pois.filter((poi) => poi.category !== 'journey' && poi.name && Number.isFinite(poi.lat) && Number.isFinite(poi.lng) && isVisiblePoi(poi))
    .filter((poi) => /park|trail|garden|greenway|nature|waterfront|historic|museum|landmark|walk/i.test(`${poi.name} ${poi.category} ${Array.isArray(poi.tags) ? poi.tags.join(' ') : ''}`));
  const ordered = sortGuideCardsByDistance(candidates, point, (poi) => [poi]);
  return ordered.filter((poi) => !point || poi.distance <= 40233).slice(0, 8).map((poi) => ({
    id: `nearby:${poi.id}`, kind: 'nearby', title: `Explore ${poi.name}`,
    reason: 'A nearby place to explore on foot. Pick your own safe walking route to this stop.', stopPlaceIds: [String(poi.id)], distance: poi.distance
  }));
}
function discoverCard(card) {
  const selected = selectedPlaceId && card.stopPlaceIds?.includes(selectedPlaceId);
  return `<article class="guide-card ${selected ? 'selected' : ''}" data-guide-card="${escapeHtml(card.id)}"><small>${card.kind === 'journey' ? 'JOURNEY' : escapeHtml(card.kind.replaceAll('+', ' + '))}${distanceLabel(card.distance)}</small><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.reason)}</p><div class="card-actions"><button class="primary-button" type="button" data-guide-walk="${escapeHtml(card.id)}">Walk this</button><button class="secondary-button" type="button" data-guide-preview="${escapeHtml(card.id)}">View on map</button></div></article>`;
}
function walkingDirection(card) {
  if (!state.activeWalk) return '';
  const route = state.plannedRoute;
  if (route?.coordinates?.length > 1 && route.stops?.some((stop) => String(stop.id) === card.placeId)) return `Follow the active planned route to ${card.question}.`;
  const edge = (state.trailSegments[state.activeCity] || []).find((edge) => edge.placeIds?.includes(card.placeId));
  return edge ? `Follow the packaged ${edge.name} line to this stop.` : 'No packaged walking direction for this stop yet.';
}
export function nearestLearnStories(cards, pois, point) {
  const byId = new Map(pois.map((poi) => [String(poi.id), poi]));
  const ordered = sortGuideCardsByDistance(cards, point, (card) => [byId.get(card.placeId)]);
  const important = new Set(selectImportantPois(ordered.map((card) => byId.get(card.placeId)).filter(Boolean)).map((poi) => String(poi.id)));
  const eligible = ordered.filter((card) => important.has(card.placeId) && card.officialUrl);
  const intros = ['news','recreation','cuisine'].map((light) => eligible.find((card) => card.light === light)).filter(Boolean);
  const chosen = new Set(intros.map((card) => card.placeId));
  return { intros, remaining: eligible.filter((card) => !chosen.has(card.placeId)) };
}
function shadeLearnBounds(enabled) {
  state.learnBoundsLayer?.remove(); state.learnBoundsLayer = null;
  const bbox = enabled ? installedPackBounds() : null;
  if (bbox && state.map && globalThis.L) state.learnBoundsLayer = L.rectangle([[bbox.south,bbox.west],[bbox.north,bbox.east]], { color: '#2d7259', weight: 1, fillOpacity: .06, interactive: false }).addTo(state.map);
}
function distanceLabel(distance) {
  if (!Number.isFinite(distance)) return '';
  return distance < 1000 ? ` \u00b7 ${Math.round(distance)} m` : ` \u00b7 ${(distance / 1609.344).toFixed(1)} mi`;
}
export function sortGuideCardsByDistance(cards, point, coordinateFor) {
  if (!point) return cards.map((card) => ({ ...card, distance: null }));
  return cards.map((card, index) => {
    const coordinates = coordinateFor(card).filter((candidate) => Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng));
    const distance = coordinates.length ? Math.min(...coordinates.map((candidate) => distanceMeters(point, candidate))) : Infinity;
    return { ...card, distance, packIndex: index };
  }).sort((left, right) => left.distance - right.distance || left.packIndex - right.packIndex);
}
function observationCard(item) {
  return `<article class="guide-card"><small>OBSERVATION${distanceLabel(item.distance)}</small><h3>${escapeHtml(item.title || item.species || 'Observation')}</h3><p>${escapeHtml(item.note || 'Saved privately in your journal.')}</p></article>`;
}
export async function renderFieldGuide(tab = state.fieldGuideTab || 'discover') {
  if (tab === 'maps') tab = 'discover';
  state.fieldGuideTab = tab;
  window.dispatchEvent(new CustomEvent('guide-tab-changed', { detail: { tab } }));
  const target = el('fieldGuideList'); if (!target) return;
  document.querySelectorAll('[data-guide-tab]').forEach((button) => button.classList.toggle('active', button.dataset.guideTab === tab));
  target.classList.toggle('hidden', tab === 'online');
  el('sharePanel')?.classList.toggle('hidden', tab !== 'online');
  if (tab !== 'learn') {
    shadeLearnBounds(false);
    stopHistoricalTopo();
    document.getElementById('backpackSheet')?.classList.remove('learn-min');
  }
  if (tab !== 'learn') {
    shadeLearnBounds(false);
    document.getElementById('backpackSheet')?.classList.remove('learn-min');
  }
  if (tab === 'online') {
    el('fieldGuideOrderNote')?.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('online-panel-render-requested'));
    return;
  }
  const data = await guideData();
  const point = state.currentPosition || state.lastPosition || state.map?.getCenter?.() || null;
  const note = el('fieldGuideOrderNote');
  if (note) {
    note.textContent = tab === 'learn' ? 'Choose a Learn view.' : (point ? `Nearest first from your ${state.currentPosition ? 'current' : state.lastPosition ? 'last' : 'map-center'} fix.` : 'Location is off, so this stays in pack order.');
    note.classList.remove('hidden');
  }
  const poiById = new Map((state.cityPois[state.activeCity] || []).map((poi) => [String(poi.id), poi]));
  if (tab === 'journal') {
    const observations = (await db.all('observations')).filter((item) => item.city === state.activeCity || !item.city);
    const ordered = sortGuideCardsByDistance(observations, point, (item) => [item.location]);
    target.innerHTML = ordered.length ? ordered.map(observationCard).join('') : '<p class="empty-state">No observations in this pack yet.</p>';
    return;
  }
  if (tab === 'learn') {
    await renderLearnHistory(target, point);
    return;
  }
  if (tab === 'discover') {
    const saved = renderSavedDiscoverExperiences();
    const queries = await renderSavedSpatialQueries();
    if (saved || queries) { target.innerHTML = `${saved || ''}${queries || ''}`; return; }
  }
  const ordered = sortGuideCardsByDistance(data.discover, point, (card) => (card.stopPlaceIds || []).map((id) => poiById.get(String(id))));
  const close = ordered.filter((card) => !point || card.distance <= 40233);
  const walks = nearbyWalks([...poiById.values()], point).filter((card) => !close.some((item) => item.stopPlaceIds?.includes(card.stopPlaceIds[0])));
  const seenKeys = new Set();
  const shown = [...close, ...walks].filter((card) => {
    const key = String(card.id || card.title || '');
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    if (card.title) seenKeys.add(card.title);
    return true;
  }).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)).slice(0, 12);
  target.innerHTML = shown.length ? shown.map(discoverCard).join('') : '<p class="empty-state">No walkable places are available near this map view yet. Move the map or choose another area to explore.</p>';
}

async function renderSavedSpatialQueries() {
  const queries = (await listSpatialQueries())
    .filter((query) => !query.regionId || query.regionId === state.activeCity)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, 12);
  if (!queries.length) return '';
  return `<section class="saved-discover-library spatial-query-library"><p class="learn-kicker">Discover Library · Spatial Queries</p>${queries.map((query) => {
    const label = query.queryType || query.shape || 'Spatial query';
    const resultCount = Array.isArray(query.resultIds) ? query.resultIds.length : 0;
    const status = query.status === 'ready' ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : 'Needs map results';
    return `<article class="guide-card saved-discover-card"><small>${escapeHtml(label)} · ${escapeHtml(status)}</small><h3>${escapeHtml(query.title || queryPrompt(query))}</h3><p>${escapeHtml(queryPrompt(query))}</p><div class="learn-site-actions"><button class="primary-button" type="button" data-view-spatial-query="${escapeHtml(query.id)}">Open on map</button></div></article>`;
  }).join('')}</section>`;
}

function renderSavedDiscoverExperiences() {
  const categories = state.personalPlaceCategories.filter((category) => category.id === 'discover' || category.id.startsWith('discover-'));
  const places = state.personalPlaces || [];
  const routes = state.savedRoutes || [];
  const experiences = categories.map((category) => ({
    category,
    selected: places.filter((place) => (place.categoryId || place.category_id) === category.id),
    route: routes.find((item) => item.discoverCategoryId === category.id) || routes.find((item) => item.title === category.name)
  })).filter((item) => item.selected.length || item.route);
  if (!experiences.length) return '';
  return `<section class="saved-discover-library"><p class="learn-kicker">Saved Discover experiences</p>${experiences.map(({ category, selected, route }) => {
    const duration = route?.durationSeconds ? `${Math.round(route.durationSeconds / 60)} min` : '';
    const distance = route?.distanceMeters ? `${(route.distanceMeters / 1609.344).toFixed(1)} mi` : '';
    const meta = [selected.length ? `${selected.length} place${selected.length === 1 ? '' : 's'}` : '', distance, duration].filter(Boolean).join(' · ');
    const stops = selected.map((place) => `<li>${escapeHtml(place.name || 'Saved place')}</li>`).join('');
    const action = route ? `<button class="primary-button" type="button" data-start-saved-discover="${escapeHtml(route.id)}">Start walk</button>` : selected.length ? `<button class="primary-button" type="button" data-plan-saved-discover="${escapeHtml(category.id)}">Start route planning</button>` : '<span class="empty-state">Route unavailable</span>';
    return `<article class="guide-card saved-discover-card"><small>Discover${meta ? ` · ${escapeHtml(meta)}` : ''}</small><h3>${escapeHtml(category.name)}</h3>${stops ? `<ul>${stops}</ul>` : '<p class="empty-state">No saved places are available for this experience.</p>'}<div class="learn-site-actions">${action}<button class="secondary-button" type="button" data-view-saved-discover="${escapeHtml(category.id)}">View on map</button></div></article>`;
  }).join('')}</section>`;
}
function planForCard(card) {
  return { pack_id: state.activeCity, title: card.title, reason: card.reason, stop_place_ids: card.stopPlaceIds || [], ...(card.journeyId ? { journeyId: card.journeyId } : {}) };
}
export function normalizeWalkPlan(value) {
  const plan = typeof value === 'string' ? JSON.parse(value) : value;
  if (!plan || plan.format !== FORMAT || !plan.pack_id || !plan.title || !Array.isArray(plan.stop_place_ids)) throw new Error('Choose a valid .walkplan file.');
  return { format: FORMAT, pack_id: String(plan.pack_id), title: String(plan.title), reason: String(plan.reason || ''), stop_place_ids: plan.stop_place_ids.map(String), ...(plan.journeyId ? { journeyId: String(plan.journeyId) } : {}) };
}
export function currentWalkPlan() {
  const route = state.plannedRoute;
  if (!route) return null;
  return normalizeWalkPlan({ format: FORMAT, pack_id: state.activeCity, title: route.title, reason: route.reason || route.description || 'A walk sketched from this installed pack.', stop_place_ids: (route.stops || []).map((stop) => stop.id).filter(Boolean), ...(route.journeyId ? { journeyId: route.journeyId } : {}) });
}
function downloadPlan(plan) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${plan.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'walk'}.walkplan`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadCurrentWalkPlan() {
  const plan = currentWalkPlan();
  if (!plan) { toast('Paint a walk before downloading it.'); return; }
  downloadPlan(plan);
}
export async function sendCurrentWalkPlan() {
  const plan = currentWalkPlan();
  if (!plan) { toast('Paint a walk before sending it.'); return; }
  const names = (state.plannedRoute.stops || []).map((stop) => stop.name).filter(Boolean).join(' \u2192 ');
  const text = [plan.title, plan.reason, names].filter(Boolean).join('\n');
  if (navigator.share) {
    const file = new File([JSON.stringify(plan, null, 2)], `${plan.title.replace(/[^a-z0-9]+/gi, '-')}.walkplan`, { type: 'application/json' });
    try { await navigator.share({ title: plan.title, text, files: navigator.canShare?.({ files: [file] }) ? [file] : undefined }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  downloadPlan(plan);
}
export function paintWalkPlan(plan) {
  const normalized = normalizeWalkPlan(plan);
  if (normalized.pack_id !== state.activeCity) {
    state.pendingWalkPlan = normalized;
    toast(`This plan belongs to ${CITIES[normalized.pack_id]?.name || normalized.pack_id}; it will open when that area enters the active viewport.`);
    return null;
  }
  const pois = state.cityPois[state.activeCity] || [];
  const stops = normalized.stop_place_ids.map((id) => pois.find((poi) => String(poi.id) === id)).filter(Boolean);
  state.plannedRoute = { ...normalized, id: `imported-${Date.now()}`, title: normalized.title, reason: normalized.reason, routeMode: 'point-to-point', stops, coordinates: [], journeyId: normalized.journeyId || null };
  if (normalized.journeyId) showCuratedRoute(normalized.journeyId);
  paintWalkConcept(state.plannedRoute);
  void routePlannedPreview(state.plannedRoute);
  closeSheets();
  if (state.activeWalk) {
    toast(`Mapped route preview for "${normalized.title}" onto your active walk.`);
  } else {
    toast(`Mapped "${normalized.title}". Tap Start Walk to begin.`);
  }
  return state.plannedRoute;
}

async function routePlannedPreview(plan) {
  const origin = state.currentPosition || state.map?.getCenter();
  if (!origin || !plan.stops?.length) return;
  const points = [{ lat: origin.lat, lng: origin.lng }, ...plan.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))];
  if (plan.routeMode === 'round-trip' || plan.routeMode === 'auto-round-trip') points.push(points[0]);
  const routed = await routeOnFoot(points, { city: state.activeCity, profile: 'ordinary_walking_beta' });
  if (!routed.ok || state.plannedRoute?.id !== plan.id) return;
  state.plannedRoute = { ...state.plannedRoute, coordinates: routed.coordinates, distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), durationSeconds: routed.durationSeconds, instructions: routed.instructions, edgeIds: routed.edgeIds, cellId: routed.cellId, cellRelease: routed.cellRelease, graphVersion: routed.graphVersion };
  window.dispatchEvent(new CustomEvent('walk-sketch-painted', { detail: state.plannedRoute }));
}
export async function paintCard(cardId) {
  const data = await guideData();
  const card = data.discover.find((item) => item.id === cardId); if (!card) return;
  const plan = paintWalkPlan({ format: FORMAT, ...planForCard(card) });
  const stop = card.stopPlaceIds?.map((id) => (state.cityPois[state.activeCity] || []).find((poi) => String(poi.id) === String(id))).find(Boolean);
  if (stop) {
    await db.put('moments', { id: `field-guide-walk:${state.activeCity}:${card.id}`, type: 'journal', city: state.activeCity, title: `Planned walk: ${card.title}`, note: `Planned a walk to ${stop.name}.`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (state.activeWalk) await addWalkWaypoint(stop);
  }
  return plan;
}
export async function previewCard(cardId) {
  const data = await guideData();
  const card = data.discover.find((item) => item.id === cardId); if (!card) return;
  const stop = card.stopPlaceIds?.map((id) => (state.cityPois[state.activeCity] || []).find((poi) => String(poi.id) === String(id))).find(Boolean);
  if (!stop || !state.map) { toast('This walk has no map location to preview yet.'); return; }
  state.fieldGuidePreviewMarker?.remove();
  state.fieldGuidePreviewMarker = L.circleMarker([stop.lat, stop.lng], { radius: 12, color: '#7a2d1d', weight: 3, fillColor: '#f3b24b', fillOpacity: .8, interactive: false }).bindTooltip(stop.name, { permanent: true, direction: 'top' }).addTo(state.map);
  state.map.flyTo([stop.lat, stop.lng], Math.max(state.map.getZoom(), 16));
  closeSheets();
  toast(`Showing ${stop.name} on the map.`);
  window.setTimeout(() => { state.fieldGuidePreviewMarker?.remove(); state.fieldGuidePreviewMarker = null; }, 8000);
}
export function initFieldGuideFilters() {
  initMapsFolders();
  window.addEventListener('map-overlay-changed', ({ detail }) => { if (!detail.open || detail.id !== 'backpackSheet') shadeLearnBounds(false); });
  window.addEventListener('layer-state-dirty', () => { if (state.modalOpen === 'backpackSheet' && state.fieldGuideTab === 'learn') void renderFieldGuide('learn'); });
  window.addEventListener('poi-visit-state-changed', () => { if (state.fieldGuideTab === 'learn') void renderFieldGuide('learn'); });
  window.addEventListener('walk-position-received', () => { if (state.modalOpen === 'backpackSheet' && state.fieldGuideTab === 'discover') void renderFieldGuide('discover'); });
  document.querySelector('.guide-tabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-guide-tab]');
    if (button) {
      const tab = button.dataset.guideTab;
      if (tab === 'learn' && state.fieldGuideTab === 'learn') setLearnScreen('home');
      void renderFieldGuide(tab);
    }
  });
  document.addEventListener('click', (event) => {
    const startSaved = event.target.closest('[data-start-saved-discover]');
    if (startSaved) {
      const route = state.savedRoutes.find((item) => item.id === startSaved.dataset.startSavedDiscover);
      if (!route) { toast('This saved route is no longer available.'); return; }
      const places = (state.personalPlaces || []).filter((place) => place.categoryId === route.discoverCategoryId);
      state.plannedRoute = { ...route, stops: places.map((place) => ({ id: place.sourcePoiId || place.id, name: place.name, lat: place.location.lat, lng: place.location.lng })), routeMode: route.routeMode || 'round-trip' };
      paintWalkConcept(state.plannedRoute);
      closeSheets();
      void startWalk({ routeMode: state.plannedRoute.routeMode });
      return;
    }
    const planSaved = event.target.closest('[data-plan-saved-discover]');
    if (planSaved) {
      const places = (state.personalPlaces || []).filter((place) => place.categoryId === planSaved.dataset.planSavedDiscover);
      if (!places.length) { toast('No saved places are available for route planning.'); return; }
      document.querySelector('input[name="routeMode"][value="auto-round-trip"]')?.click();
      import('./planner.js').then(({ generateTimeBasedPlan }) => generateTimeBasedPlan({ stops: places.map((place) => ({ id: place.sourcePoiId || place.id, name: place.name, lat: place.location.lat, lng: place.location.lng })), title: state.personalPlaceCategories.find((item) => item.id === planSaved.dataset.planSavedDiscover)?.name || 'Discover walk', reason: 'Discover saved places' }));
      return;
    }
    const viewSaved = event.target.closest('[data-view-saved-discover]');
    if (viewSaved) {
      const categoryId = viewSaved.dataset.viewSavedDiscover;
      const route = state.savedRoutes.find((item) => item.discoverCategoryId === categoryId);
      const places = (state.personalPlaces || []).filter((place) => place.categoryId === categoryId);
      const points = [...(route?.coordinates || []), ...places.map((place) => [place.location.lat, place.location.lng])];
      if (!points.length || !state.map) { toast('This Discover experience has no map location yet.'); return; }
      closeSheets(); state.map.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 16 });
      if (route) { state.plannedRoute = { ...route, stops: places.map((place) => ({ name: place.name, lat: place.location.lat, lng: place.location.lng })) }; paintWalkConcept(state.plannedRoute); }
      toast('Showing this Discover experience on the map.');
      return;
    }
    const viewQuery = event.target.closest('[data-view-spatial-query]');
    if (viewQuery) {
      void listSpatialQueries().then((queries) => {
        const query = queries.find((item) => item.id === viewQuery.dataset.viewSpatialQuery);
        if (!query) { toast('This saved Spatial Query is no longer available.'); return; }
        closeSheets();
        state.spatialQuery = query;
        state.spatialQueryDismissed = new Set();
        state.spatialQuerySelected = new Set();
        window.dispatchEvent(new CustomEvent('spatial-query-restore-requested', { detail: { query } }));
        document.querySelector('[data-map-destination="draw"]')?.click();
        toast('Showing this Spatial Query on the map.');
      });
      return;
    }
    const preview = event.target.closest('[data-guide-preview]');
    if (preview) { void previewCard(preview.dataset.guidePreview); return; }
    const cardElement = event.target.closest('[data-guide-card]');
    if (cardElement && cardElement.dataset.guideCard && !event.target.closest('a,button')) { void paintCard(cardElement.dataset.guideCard); return; }
    const walk = event.target.closest('[data-guide-walk]'); if (walk) { void paintCard(walk.dataset.guideWalk); return; }
    const home = event.target.closest('[data-learn-home]');
    if (home) { setLearnScreen('home'); void renderFieldGuide('learn'); return; }
    const basinBack = event.target.closest('[data-learn-watershed-back]');
    if (basinBack) { setLearnScreen('watersheds'); setActiveWatershed(null); void renderFieldGuide('learn'); return; }
    const battleBack = event.target.closest('[data-learn-battle-back]');
    if (battleBack) {
      const level = stepBattlefieldBack();
      setLearnScreen(level === 'home' ? 'home' : 'battlefields');
      void renderFieldGuide('learn');
      return;
    }
    const era = event.target.closest('[data-learn-era]');
    if (era) { setLearnScreen('battlefields'); setBattlefieldEra(era.dataset.learnEra); void renderFieldGuide('learn'); return; }
    const year = event.target.closest('[data-learn-year]');
    if (year) { setLearnScreen('battlefields'); setBattlefieldYear(year.dataset.learnYear); void renderFieldGuide('learn'); return; }
    const battle = event.target.closest('[data-learn-battle]');
    if (battle) { setLearnScreen('battlefields'); setBattlefieldSite(battle.dataset.learnBattle); void renderFieldGuide('learn'); return; }
    const lensBack = event.target.closest('[data-learn-lens-back]');
    if (lensBack) { setActiveLensItem(null); void renderFieldGuide('learn'); return; }
    const lensItem = event.target.closest('[data-learn-lens-item]');
    if (lensItem) { setActiveLensItem(lensItem.dataset.learnLensItem); void renderFieldGuide('learn'); return; }
    const openLearn = event.target.closest('[data-learn-open]');
    if (openLearn) { setLearnScreen(openLearn.dataset.learnOpen); void renderFieldGuide('learn'); return; }
    const basin = event.target.closest('[data-learn-watershed]');
    if (basin) { setLearnScreen('watersheds'); setActiveWatershed(basin.dataset.learnWatershed); void renderFieldGuide('learn'); return; }
    const viewButton = event.target.closest('[data-learn-view]');
    if (viewButton) { setLearnView(viewButton.dataset.learnView); void renderFieldGuide('learn'); return; }
    const topoEra = event.target.closest('[data-historical-topo-era]');
    if (topoEra) { paintHistoricalTopo({ map: state.map, leaflet: globalThis.L, era: topoEra.value, opacity: Number(event.target.closest('section')?.querySelector('[data-historical-topo-opacity]')?.value || 0.65) }); return; }
    const topoOpacity = event.target.closest('[data-historical-topo-opacity]');
    const check = event.target.closest('[data-learn-check]');
    if (check) {
      const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === check.dataset.learnCheck);
      if (poi) void setPoiVisited(poi, check.checked);
      return;
    }
    const learnWalk = event.target.closest('[data-learn-walk]');
    if (learnWalk) {
      const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === learnWalk.dataset.learnWalk);
      if (poi) {
        if (state.activeWalk) void addWalkWaypoint(poi);
        else paintWalkPlan({ format: FORMAT, pack_id: state.activeCity, title: `Walk to ${poi.name}`, reason: 'A walk from Learn.', stop_place_ids: [poi.id] });
      }
      return;
    }
    const learnPlace = event.target.closest('[data-learn-place]');
    if (learnPlace && !event.target.closest('a,button')) {
      const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === learnPlace.dataset.learnPlace);
      if (poi) { closeSheets(); state.map.flyTo([poi.lat, poi.lng], Math.max(state.map.getZoom(), 16)); }
    }
  });
  window.addEventListener('field-guide-entry-requested', (event) => { void (async () => {
    selectedPlaceId = event.detail?.poi?.id || null;
    const tab = isHistorySite(event.detail?.poi) ? 'learn' : 'discover';
    if (tab === 'learn') setLearnScreen('history');
    openSheet('backpackSheet'); await renderFieldGuide(tab);
  })(); });
  window.addEventListener('city-layer-data-changed', () => { state.fieldGuideData = null; });
}
