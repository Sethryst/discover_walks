import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { routesForCity, showCuratedRoute } from './routes.js';
import { closeSheets, openBackpack, openSheet, toast } from './ui.js';
import { paintWalkConcept } from './planner.js';

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
  const journeyCards = routesForCity(state.activeCity).map((route) => ({
    id: `journey:${route.id}`, kind: 'journey', journeyId: route.id, title: route.title,
    reason: route.description || 'A sourced journey through named places.',
    stopPlaceIds: [...new Set(route.chapters.flatMap((chapter) => [...(chapter.stops || []), ...(chapter.amenities || [])].map((stop) => stop.id)).filter(Boolean))]
  }));
  const byId = new Map([...(discover.cards || []), ...journeyCards].map((card) => [card.id, card]));
  state.fieldGuideData = { city: state.activeCity, discover: [...byId.values()], learn: learn.cards || [] };
  return state.fieldGuideData;
}

function discoverCard(card) {
  const selected = selectedPlaceId && card.stopPlaceIds?.includes(selectedPlaceId);
  return `<article class="guide-card ${selected ? 'selected' : ''}" data-guide-card="${escapeHtml(card.id)}"><small>${card.kind === 'journey' ? 'JOURNEY' : escapeHtml(card.kind.replaceAll('+', ' + '))}</small><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.reason)}</p><button class="primary-button" type="button" data-guide-walk="${escapeHtml(card.id)}">Walk this</button></article>`;
}

function learnCard(card) {
  return `<article class="guide-card" data-learn-place="${escapeHtml(card.placeId)}"><h3>${escapeHtml(card.question)}</h3><p>${escapeHtml(card.short)}</p><a href="${escapeHtml(card.officialUrl)}" target="_blank" rel="noreferrer">${escapeHtml(card.provenance?.name || 'Official source')} ↗</a><button class="secondary-button" type="button" data-learn-walk="${escapeHtml(card.placeId)}">Walk there</button></article>`;
}

export async function renderFieldGuide(tab = state.fieldGuideTab || 'discover') {
  state.fieldGuideTab = tab;
  const target = el('fieldGuideList'); if (!target) return;
  document.querySelectorAll('[data-guide-tab]').forEach((button) => button.classList.toggle('active', button.dataset.guideTab === tab));
  target.classList.toggle('hidden', tab === 'share');
  el('sharePanel')?.classList.toggle('hidden', tab !== 'share');
  if (tab === 'share') {
    const friends = (state.online.leaderboard || []).map((friend) => friend.username).filter(Boolean);
    if (el('friendSharePicker')) el('friendSharePicker').innerHTML = friends.map((name) => `<span class="poi-chip">@${escapeHtml(name)}</span>`).join('');
    return;
  }
  const data = await guideData();
  const cards = tab === 'learn' ? data.learn : data.discover;
  const ordered = selectedPlaceId ? [...cards].sort((left, right) => Number((right.placeId === selectedPlaceId) || right.stopPlaceIds?.includes(selectedPlaceId)) - Number((left.placeId === selectedPlaceId) || left.stopPlaceIds?.includes(selectedPlaceId))) : cards;
  target.innerHTML = ordered.length ? ordered.slice(0, 6).map(tab === 'learn' ? learnCard : discoverCard).join('') : '';
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
  document.querySelector('.guide-tabs')?.addEventListener('click', (event) => { const button = event.target.closest('[data-guide-tab]'); if (button) void renderFieldGuide(button.dataset.guideTab); });
  el('fieldGuideList')?.addEventListener('click', (event) => {
    const walk = event.target.closest('[data-guide-walk]'); if (walk) { void paintCard(walk.dataset.guideWalk); return; }
    const learnWalk = event.target.closest('[data-learn-walk]');
    if (learnWalk) {
      const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === learnWalk.dataset.learnWalk);
      if (poi) paintWalkPlan({ format: FORMAT, pack_id: state.activeCity, title: `Walk to ${poi.name}`, reason: `A sourced place from the ${CITIES[state.activeCity]?.name || 'installed'} pack.`, stop_place_ids: [poi.id] });
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
