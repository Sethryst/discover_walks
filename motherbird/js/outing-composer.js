import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { toast } from './ui.js';
import { routeOnFoot, routeFailureMessage } from './routing.js?v=20261104-valhalla-wasm-1';
import { paintWalkConcept } from './planner.js?v=20261014-single-composed-walk-1';
import { findInterestingDetour } from './mip-discovery.js?v=20261104-duckdb-mip-1';
import { startWalk, getCurrentLocation } from './walk.js';
import { createWalkPlan, saveWalkPlan } from './walk-plan.js';
import {
  ACTIVE_OUTING_DRAFT_ID,
  addOutingItem,
  branchOutingDraft,
  ensureOutingDraft,
  linkOutingToWalk,
  outingRouteItems,
  removeOutingItem,
  setOutingItemRole,
  updateOutingPreferences,
  updateOutingRoutePreview
} from './outing-draft.js?v=20261104-travel-modes-1';

const roleLabels = {
  'possible-stop': 'Possible stop',
  destination: 'Destination',
  start: 'Start point',
  'pass-through': 'Pass through',
  avoid: 'Avoid'
};
let routeGeneration = 0;
let suggestion = null;
let suggestionLoading = false;
let initialized = false;
let routeProvider = routeOnFoot;
let compositionMutation = Promise.resolve();

export function setOutingRouteProvider(provider = routeOnFoot) { routeProvider = provider; }

function panel() { return document.getElementById('startPanel'); }
function distanceLabel(meters) {
  const value = Number(meters || 0);
  return value >= 1609.344 ? `${(value / 1609.344).toFixed(1)} mi` : value ? `${Math.round(value)} m` : 'Not routed yet';
}
function durationLabel(seconds, travelMode = 'walking') {
  const value = Number(seconds || 0);
  const label = travelMode === 'driving' ? 'driving' : travelMode === 'cycling' ? 'cycling' : 'walking';
  return value ? `${Math.max(1, Math.round(value / 60))} min ${label}` : 'Time emerges with the route';
}
function itemFacts(item) {
  const facts = Array.isArray(item?.facts) ? item.facts.filter(Boolean).slice(0, 2) : [];
  return facts.length ? facts.join(' · ') : `${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)}`;
}

export function composerMarkup() {
  return `<div class="outing-composer" data-outing-composer>
    <header class="outing-composer-header"><div><p class="walk-planner-kicker">OPEN WALK COMPOSER</p><h2>Compose an outing</h2><p>Start anywhere. Add a place, explore the map, or let the route emerge.</p></div></header>
    <div class="outing-start-tools" aria-label="Ways to begin">
      <button type="button" class="secondary-button" data-outing-map-place>Add a map place</button>
      <button type="button" class="secondary-button" data-outing-location>Use my location</button>
      <label class="outing-saved-place">Saved place<select data-outing-saved-place><option value="">Choose if useful…</option></select></label>
      <label class="outing-recipe">Feeling<select data-outing-recipe><option value="">No preference</option><option value="shaded-nature">Green and shaded</option><option value="water-history">Water and stories</option><option value="step-free-neighborhood">Neighborhood places</option></select></label>
      <label class="outing-saved-place">Travel by<select data-outing-travel-mode><option value="walking">Walking</option><option value="cycling">Bicycle</option><option value="driving">Car</option></select></label>
    </div>
    <section class="outing-items" aria-labelledby="outingItemsTitle"><div class="outing-section-heading"><strong id="outingItemsTitle">Places in this outing</strong><small data-outing-place-count>0 places</small></div><div data-outing-items></div></section>
    <section class="outing-summary" aria-live="polite"><div><small>Route consequence</small><strong data-outing-distance>Not routed yet</strong><span data-outing-duration>Time emerges with the route</span></div><p data-outing-status>Add places only when they help. Nothing is required.</p></section>
    <section class="outing-suggestions"><div class="outing-section-heading"><strong>Optional discovery</strong><button type="button" class="text-button" data-outing-dismiss-suggestion>Dismiss</button></div><div class="outing-suggestion-tools"><button type="button" data-outing-suggest="nearby">Suggest a nearby place</button><button type="button" data-outing-suggest="surprise">Surprise me</button><button type="button" data-outing-suggest="green">Add a green place</button><button type="button" data-outing-suggest="route">Find something along this route</button></div><div data-outing-suggestion></div></section>
    <div class="outing-composer-actions"><button type="button" class="primary-button" data-outing-start>Start this outing</button><button type="button" class="secondary-button" data-outing-preview>Update route</button><button type="button" class="secondary-button" data-outing-branch>Try another arrangement</button><button type="button" class="text-button" data-outing-save>Save for later</button></div>
  </div>`;
}

export function renderOutingComposer(draft = state.outingDraft) {
  const root = panel()?.querySelector('[data-outing-composer]');
  if (!root || !draft) return;
  const items = draft.items || [];
  root.querySelector('[data-outing-place-count]').textContent = `${items.length} place${items.length === 1 ? '' : 's'}`;
  root.querySelector('[data-outing-items]').innerHTML = items.length
    ? items.map((item) => `<article class="outing-item" data-outing-item="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(itemFacts(item))}</small></div><label><span class="sr-only">Role for ${escapeHtml(item.name)}</span><select data-outing-role><option value="possible-stop" ${item.role === 'possible-stop' ? 'selected' : ''}>Possible stop</option><option value="destination" ${item.role === 'destination' ? 'selected' : ''}>Destination</option><option value="start" ${item.role === 'start' ? 'selected' : ''}>Start point</option><option value="pass-through" ${item.role === 'pass-through' ? 'selected' : ''}>Pass through</option><option value="avoid" ${item.role === 'avoid' ? 'selected' : ''}>Avoid</option></select></label><button type="button" class="text-button" data-outing-remove aria-label="Remove ${escapeHtml(item.name)}">Remove</button></article>`).join('')
    : '<div class="outing-empty"><strong>Your canvas is open.</strong><p>Inspecting a place never adds it. You can also start recording with this draft empty.</p></div>';
  root.querySelector('[data-outing-distance]').textContent = distanceLabel(draft.routePreview?.distanceMeters);
  root.querySelector('[data-outing-duration]').textContent = durationLabel(draft.routePreview?.durationSeconds, draft.travelMode);
  const unresolved = items.filter((item) => item.role !== 'avoid' && !Number.isFinite(Number(item.lat))).length;
  const status = draft.routePreview?.status === 'failed'
    ? draft.routePreview.message
    : draft.routePreview?.status === 'routing'
      ? 'Connecting the places you chose…'
      : draft.routePreview?.status === 'ready'
        ? `${items.filter((item) => item.role !== 'avoid').length} included · ${unresolved ? `${unresolved} unresolved · ` : ''}${draft.travelMode === 'driving' ? 'Driving' : draft.travelMode === 'cycling' ? 'Cycling' : 'Walking'} time and distance are consequences, never limits.`
        : draft.routePreview?.message || 'Add places only when they help. Nothing is required.';
  root.querySelector('[data-outing-status]').textContent = status;
  root.querySelector('[data-outing-recipe]').value = draft.recipeId || '';
  root.querySelector('[data-outing-travel-mode]').value = draft.travelMode || 'walking';
  const savedSelect = root.querySelector('[data-outing-saved-place]');
  const currentValue = savedSelect.value;
  savedSelect.innerHTML = '<option value="">Choose if useful…</option>' + (state.personalPlaces || []).map((place) => `<option value="${escapeHtml(String(place.id))}">${escapeHtml(place.name || 'Saved place')}</option>`).join('');
  savedSelect.value = currentValue;
  const suggestionTarget = root.querySelector('[data-outing-suggestion]');
  root.querySelector('[data-outing-dismiss-suggestion]').classList.toggle('hidden', !suggestion);
  suggestionTarget.innerHTML = suggestionLoading
    ? '<p class="outing-suggestion-empty">Checking local places against this route…</p>'
    : suggestion ? `<article class="outing-suggestion"><div><strong>${escapeHtml(suggestion.name)}</strong><p>${escapeHtml(suggestion.explanation)}</p></div><button type="button" data-outing-accept-suggestion>Add to outing</button></article>` : '<p class="outing-suggestion-empty">Suggestions wait until you ask and never change the draft on their own.</p>';
}

function routePoints(draft) {
  const items = outingRouteItems(draft);
  if (items.length >= 2) return items;
  if (items.length === 1) {
    const origin = state.currentPosition || state.lastPosition;
    if (origin && items[0].role !== 'start') return [origin, items[0]];
  }
  return items;
}

export async function recalculateOutingRoute(draft = state.outingDraft) {
  const request = ++routeGeneration;
  const points = routePoints(draft);
  if (points.length < 2) {
    const next = await updateOutingRoutePreview({ status: 'idle', coordinates: [], distanceMeters: 0, durationSeconds: 0, message: points.length ? 'One place is included. Add another only if you want a route.' : 'Add places when you want the route to emerge.' }, draft);
    renderOutingComposer(next);
    return next;
  }
  let working = await updateOutingRoutePreview({ status: 'routing', message: 'Connecting the places you chose…' }, draft);
  renderOutingComposer(working);
  const profile = draft.travelMode === 'driving' ? 'driving_beta' : draft.travelMode === 'cycling' ? 'cycling_beta' : 'ordinary_walking_beta';
  const routed = await routeProvider(points, { city: draft.city || state.activeCity, profile }).catch((error) => ({ ok: false, status: 'ROUTING_WORKER_ERROR', failure: { message: error?.message } }));
  if (request !== routeGeneration) return state.outingDraft;
  if (!routed.ok) {
    working = await updateOutingRoutePreview({ status: 'failed', coordinates: [], distanceMeters: 0, durationSeconds: 0, message: routeFailureMessage(routed) || 'These places are not connected by the installed walking network. Your draft is unchanged.' }, working);
    renderOutingComposer(working);
    return working;
  }
  working = await updateOutingRoutePreview({ status: 'ready', coordinates: routed.coordinates, distanceMeters: routed.distanceMeters, durationSeconds: routed.durationSeconds, graphVersion: routed.graphVersion, cellId: routed.cellId, cellRelease: routed.cellRelease, edgeIds: routed.edgeIds, instructions: routed.instructions, message: 'Route updated. Time and distance are consequences, never gates.' }, working);
  const stops = outingRouteItems(working);
  state.plannedRoute = {
    id: working.plannedRouteId || working.draftId,
    title: 'Your composed outing',
    reason: `${stops.length} place${stops.length === 1 ? '' : 's'} connected in the arrangement you chose.`,
    city: working.city || state.activeCity,
    routeMode: 'composer',
    travelMode: working.travelMode,
    profile,
    stops,
    coordinates: routed.coordinates,
    distanceMeters: routed.distanceMeters,
    distanceMiles: Number((Number(routed.distanceMeters || 0) / 1609.344).toFixed(2)),
    durationSeconds: routed.durationSeconds,
    estimatedDurationMinutes: Math.round(Number(routed.durationSeconds || 0) / 60),
    graphVersion: routed.graphVersion,
    cellId: routed.cellId,
    cellRelease: routed.cellRelease,
    edgeIds: routed.edgeIds,
    instructions: routed.instructions,
    outingDraftId: working.draftId
  };
  paintWalkConcept(state.plannedRoute, { fit: false });
  renderOutingComposer(working);
  return working;
}

function candidateSuggestion(kind) {
  const existing = new Set((state.outingDraft?.items || []).map((item) => String(item.placeId)));
  let candidates = [...(state.cityPois[state.activeCity] || []), ...(state.personalPlaces || [])]
    .filter((place) => !existing.has(String(place.id)))
    .map((place) => ({ ...place, lat: Number(place.lat ?? place.location?.lat), lng: Number(place.lng ?? place.location?.lng) }))
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  if (kind === 'green') candidates = candidates.filter((place) => /park|green|nature|garden|trail|forest/i.test(`${place.name || ''} ${(place.tags || []).join(' ')} ${place.category || ''}`));
  const origin = state.currentPosition || state.lastPosition || state.map?.getCenter?.();
  if (origin) candidates.sort((a, b) => Math.hypot(a.lat - origin.lat, a.lng - origin.lng) - Math.hypot(b.lat - origin.lat, b.lng - origin.lng));
  const choice = kind === 'surprise' ? candidates[Math.floor(Math.random() * Math.min(candidates.length, 12))] : candidates[0];
  if (!choice) return null;
  const tags = [...(choice.tags || []), choice.category].filter(Boolean).slice(0, 2);
  return { ...choice, explanation: `${tags.length ? `${tags.join(' and ')} · ` : ''}${origin ? 'near the area you are exploring' : 'from the installed local place catalogue'}.` };
}

async function routeSuggestion(draft = state.outingDraft) {
  const points = routePoints(draft);
  if (points.length < 2) return null;
  const directRoute = draft.routePreview?.status === 'ready'
    ? { ...draft.routePreview, ok: true }
    : null;
  return findInterestingDetour({
    points,
    directRoute,
    pois: [...(state.cityPois[state.activeCity] || []), ...(state.personalPlaces || [])],
    travelMode: draft.travelMode || 'walking',
    city: draft.city || state.activeCity,
    routeProvider,
    existingPlaceIds: (draft.items || []).map((item) => item.placeId).filter(Boolean)
  });
}

async function addMapPoint(point, role) {
  const draft = await addOutingItem({ name: point.name || 'Map place', placeId: point.id || null, lat: point.lat, lng: point.lng, source: point.source || 'map', facts: point.facts || [] }, role);
  renderOutingComposer(draft);
  await recalculateOutingRoute(draft);
}

function queueMapPoint(point, role) {
  compositionMutation = compositionMutation.then(() => addMapPoint(point, role));
  return compositionMutation;
}

export function openMapActionPopup({ lat, lng, place = null }) {
  if (!state.map || !globalThis.L || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
  const name = place?.name || 'This map place';
  const wrapper = document.createElement('div');
  wrapper.className = 'outing-map-actions';
  wrapper.innerHTML = `<strong>${escapeHtml(name)}</strong><small>Inspecting only — choose an action if this place belongs in the outing.</small><button type="button" data-map-outing-role="possible-stop">Add to outing</button><button type="button" data-map-outing-role="destination">Mark as destination</button><button type="button" data-map-outing-role="pass-through">Pass through</button><button type="button" data-map-outing-role="avoid">Avoid</button>`;
  wrapper.addEventListener('click', (event) => {
    const role = event.target.closest('[data-map-outing-role]')?.dataset.mapOutingRole;
    if (!role) return;
    void queueMapPoint({ ...place, name, lat: Number(lat), lng: Number(lng) }, role);
    state.map.closePopup();
  });
  L.popup({ maxWidth: 310, className: 'outing-map-popup' }).setLatLng([lat, lng]).setContent(wrapper).openOn(state.map);
}

async function startComposedOuting() {
  let draft = state.outingDraft || await ensureOutingDraft();
  if (draft.routePreview?.status === 'ready' && draft.routePreview.coordinates?.length >= 2) {
    const route = { ...draft.routePreview, coordinates: draft.routePreview.coordinates };
    const stops = outingRouteItems(draft);
    const plan = createWalkPlan({
      planId: draft.plannedRouteId || `walk-plan:${draft.draftId}`,
      revision: 1,
      request: { city: draft.city || state.activeCity, recipeId: draft.recipeId, durationMinutes: draft.timePreferenceMinutes, routeMode: 'composer', travelMode: draft.travelMode, outingDraftId: draft.draftId },
      route,
      encounters: stops.map((item, position) => ({ ...item, placeId: item.placeId, position, reason: `Walker assigned this place as ${roleLabels[item.role].toLocaleLowerCase()}.` })),
      rationale: { summary: 'The walker chose these places and roles; the router only connected them.', limitations: [] }
    });
    await saveWalkPlan(plan);
    draft = await updateOutingRoutePreview(draft.routePreview, { ...draft, plannedRouteId: plan.id });
  }
  const walk = await startWalk({ routeMode: draft.routePreview?.status === 'ready' ? 'composer' : 'tracking', transportMode: draft.travelMode, outingDraftId: draft.draftId, plannedPlaces: draft.items });
  if (!walk) return;
  await linkOutingToWalk(walk.id, draft);
  panel()?.classList.add('hidden');
  toast(draft.items.length ? 'Outing started. The draft and anything you encounter stay linked.' : 'Recording started. This empty outing can take shape while you walk.');
}

export async function openOutingComposer() {
  const target = panel();
  if (!target) return;
  // The shell can finish mounting after composer initialization. Re-home the
  // panel at open time so it is not trapped inside the top toolbar's mobile
  // layout, where fixed positioning can place it off-screen.
  const frame = document.querySelector('.viewfinder-frame');
  if (frame && target.parentElement !== frame) frame.append(target);
  const draft = state.outingDraft || await ensureOutingDraft({ city: state.activeCity });
  target.classList.remove('hidden');
  target.style.display = 'block';
  document.getElementById('startChevron')?.setAttribute('aria-expanded', 'true');
  state.planningMode = true;
  renderOutingComposer(draft);
}

export async function initOutingComposer() {
  const target = panel();
  if (!target || initialized) return;
  initialized = true;
  window.addEventListener('map-place-actions-requested', (event) => {
    if (event.detail?.gesture !== 'intentional') return;
    const place = event.detail?.place;
    if (place) openMapActionPopup({ lat: place.lat, lng: place.lng, place });
  });
  document.querySelector('.viewfinder-frame')?.append(target);
  target.innerHTML = composerMarkup();
  const composerToggle = document.getElementById('startChevron');
  if (composerToggle) { composerToggle.textContent = 'Compose'; composerToggle.setAttribute('aria-label', 'Compose an outing'); }
  window.addEventListener('outing-composer-open-requested', () => void openOutingComposer());
  const draft = await ensureOutingDraft({ city: state.activeCity });
  renderOutingComposer(draft);
  target.addEventListener('change', async (event) => {
    const item = event.target.closest('[data-outing-item]');
    if (event.target.matches('[data-outing-role]') && item) {
      const next = await setOutingItemRole(item.dataset.outingItem, event.target.value);
      renderOutingComposer(next); await recalculateOutingRoute(next); return;
    }
    if (event.target.matches('[data-outing-recipe]')) { renderOutingComposer(await updateOutingPreferences({ recipeId: event.target.value })); return; }
    if (event.target.matches('[data-outing-travel-mode]')) { const next = await updateOutingPreferences({ travelMode: event.target.value }); renderOutingComposer(next); await recalculateOutingRoute(next); return; }
    if (event.target.matches('[data-outing-saved-place]') && event.target.value) {
      const place = (state.personalPlaces || []).find((candidate) => String(candidate.id) === event.target.value);
      if (place) await queueMapPoint({ ...place, lat: place.lat ?? place.location?.lat, lng: place.lng ?? place.location?.lng, source: 'saved-place' }, 'possible-stop');
    }
  });
  target.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-outing-item]');
    if (event.target.closest('[data-outing-remove]') && item) { const next = await removeOutingItem(item.dataset.outingItem); renderOutingComposer(next); await recalculateOutingRoute(next); return; }
    if (event.target.closest('[data-outing-map-place]')) { target.classList.add('outing-composer-picking'); toast('Tap anywhere on the map. You can inspect it before adding it.'); return; }
    if (event.target.closest('[data-outing-location]')) {
      if (state.currentPosition || state.lastPosition) await queueMapPoint({ name: 'My location', ...(state.currentPosition || state.lastPosition), source: 'location' }, 'start');
      else { getCurrentLocation(); toast('Finding your location. Tap “Use my location” again when the location marker appears.'); }
      return;
    }
    if (event.target.closest('[data-outing-preview]')) { await recalculateOutingRoute(); return; }
    if (event.target.closest('[data-outing-start]')) { await startComposedOuting(); return; }
    if (event.target.closest('[data-outing-branch]')) { const next = await branchOutingDraft(); renderOutingComposer(next); toast('Another arrangement is ready. The earlier draft remains stored on this device.'); return; }
    if (event.target.closest('[data-outing-save]')) { target.classList.add('hidden'); state.planningMode = false; toast('Outing draft saved on this device.'); return; }
    const suggestKind = event.target.closest('[data-outing-suggest]')?.dataset.outingSuggest;
    if (suggestKind === 'route') {
      suggestionLoading = true; suggestion = null; renderOutingComposer();
      suggestion = await routeSuggestion(state.outingDraft);
      suggestionLoading = false; renderOutingComposer();
      if (!suggestion) toast('No practical local detour was found along this route. Your outing is unchanged.');
      return;
    }
    if (suggestKind) { suggestion = candidateSuggestion(suggestKind); renderOutingComposer(); if (!suggestion) toast('No matching local place is available in this map area.'); return; }
    if (event.target.closest('[data-outing-dismiss-suggestion]')) { suggestion = null; renderOutingComposer(); return; }
    if (event.target.closest('[data-outing-accept-suggestion]') && suggestion) { const accepted = suggestion; suggestion = null; await queueMapPoint(accepted, 'possible-stop'); }
  });
  window.addEventListener('outing-draft-changed', (event) => renderOutingComposer(event.detail));
  window.addEventListener('outing-place-action', (event) => void queueMapPoint(event.detail?.place || {}, event.detail?.role || 'possible-stop'));
}
