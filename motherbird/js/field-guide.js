import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { routesForCity, showCuratedRoute } from './routes.js';
import { closeSheets, openBackpack, openSheet, toast } from './ui.js';
import { paintWalkConcept } from './planner.js';
import { distanceMeters } from './geo.js';
import db from './storage.js';
import { isVisiblePoi, selectImportantPois } from './poi.js';
import { placeLight, publicPlaceSource, walkerDetails } from './place-details.js';
import { installedPackBounds } from './offline-view.js';

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
    return {
      ...card,
      id: String(card.id),
      kind: card.kind || (card.journeyId ? 'journey' : 'walk'),
      title: card.title || 'A walk from this pack',
      reason: card.reason || '',
      stopPlaceIds,
      ...(route?.coordinates?.length > 1 ? { coordinates: route.coordinates } : {})
    };
  }).filter(Boolean);
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
    return [{ ...authored, id: authored?.id || `learn:${poi.id}`, placeId: String(poi.id), place_id: String(poi.id), light: placeLight(poi), question: authored?.question || poi.name, short: authored?.short || details.map((row) => row.text).join(' · ') || `${poi.name} is a named stop in this pack. Open the public source for its local story and visiting details.`, officialUrl: source.url, provenance: { name: source.name || 'Public source' } }];
  });
  state.fieldGuideData = { city: state.activeCity, discover: discoverCards, learn: combined };
  return state.fieldGuideData;
}

function publicSourceForPoi(poi, authored) { return publicPlaceSource(poi, authored); }

function discoverCard(card) {
  const selected = selectedPlaceId && card.stopPlaceIds?.includes(selectedPlaceId);
  return `<article class="guide-card ${selected ? 'selected' : ''}" data-guide-card="${escapeHtml(card.id)}"><small>${card.kind === 'journey' ? 'JOURNEY' : escapeHtml(card.kind.replaceAll('+', ' + '))}${distanceLabel(card.distance)}</small><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.reason)}</p><button class="primary-button" type="button" data-guide-walk="${escapeHtml(card.id)}">Walk this</button></article>`;
}

function walkingDirection(card) {
  if (!state.activeWalk) return '';
  const route = state.plannedRoute;
  if (route?.coordinates?.length > 1 && route.stops?.some((stop) => String(stop.id) === card.placeId)) return `Follow the active planned route to ${card.question}.`;
  const edge = (state.trailSegments[state.activeCity] || []).find((edge) => edge.placeIds?.includes(card.placeId));
  return edge ? `Follow the packaged ${edge.name} line to this stop.` : 'No packaged walking direction for this stop yet.';
}
function learnCard(card, intro = false) {
  const direction = walkingDirection(card);
  return `<article class="guide-card learn-story ${intro ? 'intro-story' : ''}" data-learn-place="${escapeHtml(card.placeId)}" data-story-light="${card.light}"><small>${card.light.toUpperCase()}${intro ? ' · NEAREST STORY' : ''}${distanceLabel(card.distance)}</small><h3>${escapeHtml(card.question)}</h3><p>${escapeHtml(card.short)}</p><a href="${escapeHtml(card.officialUrl)}" target="_blank" rel="noreferrer">${escapeHtml(card.provenance?.name || 'Official source')} ↗</a>${direction ? `<p class="walking-direction">${escapeHtml(direction)}</p>` : ''}<button class="secondary-button" type="button" data-learn-walk="${escapeHtml(card.placeId)}">Walk there</button></article>`;
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
  return distance < 1000 ? ` · ${Math.round(distance)} m` : ` · ${(distance / 1609.344).toFixed(1)} mi`;
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
  state.fieldGuideTab = tab;
  window.dispatchEvent(new CustomEvent('guide-tab-changed', { detail: { tab } }));
  const target = el('fieldGuideList'); if (!target) return;
  document.querySelectorAll('[data-guide-tab]').forEach((button) => button.classList.toggle('active', button.dataset.guideTab === tab));
  target.classList.toggle('hidden', ['online','maps'].includes(tab));
  el('sharePanel')?.classList.toggle('hidden', tab !== 'online');
  el('myMapsPanel')?.classList.toggle('hidden', tab !== 'maps');
  shadeLearnBounds(tab === 'learn');
  if (['online','maps'].includes(tab)) {
    el('fieldGuideOrderNote')?.classList.add('hidden');
    if (tab === 'online') window.dispatchEvent(new CustomEvent('online-panel-render-requested'));
    return;
  }
  const data = await guideData();
  const point = state.currentPosition || state.lastPosition || (tab === 'learn' ? state.map?.getCenter?.() : null);
  const note = el('fieldGuideOrderNote');
  if (note) {
    note.textContent = point ? `Nearest first from your ${state.currentPosition ? 'current' : state.lastPosition ? 'last' : 'map-center'} fix.` : 'Location is off, so this stays in pack order.';
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
    const stories = nearestLearnStories(data.learn, [...poiById.values()], point);
    const missing = ['news', 'recreation', 'cuisine'].filter((light) => !stories.intros.some((card) => card.light === light));
    if (note && missing.length) note.textContent += ` No current mapped, public-source ${missing.map((light) => light.toUpperCase()).join(' / ')} point is available.`;
    target.innerHTML = stories.intros.map((card) => learnCard(card, true)).join('') + stories.remaining.map((card) => learnCard(card)).join('');
    if (!stories.intros.length) target.innerHTML = '<p class="empty-state">No mapped, public-source stories are available in this pack.</p>';
    return;
  }
  const cards = tab === 'learn' ? data.learn : data.discover;
  const ordered = sortGuideCardsByDistance(cards, point, (card) => tab === 'learn'
    ? [poiById.get(String(card.placeId))]
    : (card.stopPlaceIds || []).map((id) => poiById.get(String(id))));
  target.innerHTML = ordered.length ? ordered.map(tab === 'learn' ? learnCard : discoverCard).join('') : '';
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
  document.body.append(link);
  link.click();
  link.remove();
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
  const names = (state.plannedRoute.stops || []).map((stop) => stop.name).filter(Boolean).join(' → ');
  const text = [plan.title, plan.reason, names].filter(Boolean).join('\n');
  if (navigator.share) {
    const file = new File([JSON.stringify(plan, null, 2)], `${plan.title.replace(/[^a-z0-9]+/gi, '-')}.walkplan`, { type: 'application/json' });
    try { await navigator.share({ title: plan.title, text, files: navigator.canShare?.({ files: [file] }) ? [file] : undefined }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  downloadPlan(plan);
}

export function paintWalkPlan(plan) {
  const normalized = normalizeWalkPlan(plan);
  if (state.activeWalk) {
    state.pendingWalkPlan = normalized;
    toast('Walk plan queued until this walk ends.');
    return null;
  }
  if (normalized.pack_id !== state.activeCity) {
    state.pendingWalkPlan = normalized;
    toast(`This plan is for ${CITIES[normalized.pack_id]?.name || normalized.pack_id}. Choose that installed region first.`);
    openSheet('regionSheet');
    return null;
  }
  const pois = state.cityPois[state.activeCity] || [];
  const stops = normalized.stop_place_ids.map((id) => pois.find((poi) => String(poi.id) === id)).filter(Boolean);
  state.plannedRoute = { ...normalized, id: `imported-${Date.now()}`, title: normalized.title, reason: normalized.reason, routeMode: 'concept', stops, coordinates: [], journeyId: normalized.journeyId || null };
  if (normalized.journeyId) showCuratedRoute(normalized.journeyId);
  paintWalkConcept(state.plannedRoute);
  closeSheets();
  return state.plannedRoute;
}

async function paintCard(cardId) {
  const data = await guideData();
  const card = data.discover.find((item) => item.id === cardId); if (!card) return;
  paintWalkPlan({ format: FORMAT, ...planForCard(card) });
}

export function initFieldGuideFilters() {
  window.addEventListener('map-overlay-changed', ({ detail }) => { if (!detail.open || detail.id !== 'backpackSheet') shadeLearnBounds(false); });
  window.addEventListener('layer-state-dirty', () => { if (state.modalOpen === 'backpackSheet' && state.fieldGuideTab === 'learn') void renderFieldGuide('learn'); });
  document.querySelector('.guide-tabs')?.addEventListener('click', (event) => { const button = event.target.closest('[data-guide-tab]'); if (button) void renderFieldGuide(button.dataset.guideTab); });
  el('fieldGuideList')?.addEventListener('click', (event) => {
    const cardElement = event.target.closest('[data-guide-card]');
    if (cardElement && !event.target.closest('a,button')) { void paintCard(cardElement.dataset.guideCard); return; }
    const walk = event.target.closest('[data-guide-walk]'); if (walk) { void paintCard(walk.dataset.guideWalk); return; }
    const learnWalk = event.target.closest('[data-learn-walk]');
    if (learnWalk) {
      void (async () => {
        const data = await guideData();
        const card = data.learn.find((item) => String(item.placeId) === learnWalk.dataset.learnWalk);
        const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === learnWalk.dataset.learnWalk);
        if (poi) paintWalkPlan({ format: FORMAT, pack_id: state.activeCity, title: `Walk to ${poi.name}`, reason: card?.short || '', stop_place_ids: [poi.id] });
      })();
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
    const data = await guideData();
    const tab = data.learn.some((card) => card.placeId === selectedPlaceId) ? 'learn' : 'discover';
    openSheet('backpackSheet'); await renderFieldGuide(tab);
  })(); });
  window.addEventListener('city-layer-data-changed', () => { state.fieldGuideData = null; });
}
