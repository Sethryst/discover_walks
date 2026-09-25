import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { saveJournal, saveJournalOnClose, renderArchive } from './archive.js';
import { getCurrentLocation, startWalk, stopWalk } from './walk.js';
import { openBackpack, openJournal, closeSheets, openSheet, renderGeofenceCategoryChips, setArchiveFilter, toast } from './ui.js';
import { city, searchPois } from './poi.js';
import { localSearchHits, searchRowHtml, emptySearchHtml, widenSearch } from './search.js';
import { switchCity } from './city.js';
import { generateTimeBasedPlan, lockSelectedPlanOnMap, changePlan } from './planner.js';
import { routeOnFoot } from './routing.js';
import { paintWalkPlan, paintCard, previewCard, sendCurrentWalkPlan } from './field-guide.js?v=132';
import { wordCount } from './reflection.js';
import { refreshCompanionState } from './companion.js';
import db from './storage.js';
import { openObservation, saveObservation, setDraftObservationIcon } from './observation.js';
import { transcribeJournal, toggleJournalRecording, stopJournalCapture } from './journal-capture.js';
import { renderNearbyPlaces, initJournalPane } from './journal-pane.js';
import { openGeoCypher } from './geo-cypher.js';
import { openRadioForContext } from './radio.js?v=20260925-radio-v3';
import { initMessengerBird } from './messenger-bird.js';
import { restartCoachMarks } from './coach.js';
import { savePlannedRoute } from './saved-routes.js';
import { recordSessionRoutingOutcome } from './routing-feedback.js';
import { openRoomForPlace } from './room-runtime.js';

const COSTUMES = ['Inky', 'Fox', 'Cloud', 'Compass'];

export function initEvents() {
  window.addEventListener('walk-position-received', ({ detail }) => void updateActiveManeuver(detail));
  initJournalPane();
  bindSheets(); bindLocationControls(); bindCompanionMenu(); bindWalkControls(); bindSearch(); bindJournal(); bindDeviceControls();
  initMessengerBird();
  bindMapWorkspace();
  el('settingsButton')?.addEventListener('click', toggleFieldGuideMenu);
  el('fieldGuideDropdown')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-field-guide]')) openBackpack();
    closeFieldGuideMenu();
  });
  el('journalButton')?.addEventListener('click', () => void openJournal());
  el('geoCypherButton')?.addEventListener('click', () => void openGeoCypher());
  window.addEventListener('room-open-requested', (event) => void openRoomForPlace(event.detail?.place));
  window.addEventListener('room-sheet-open-requested', () => openSheet('roomSheet'));
  el('roomAudioButton')?.addEventListener('click', () => void openGeoCypher());
  el('roomJournalButton')?.addEventListener('click', () => void openJournal());
  el('roomRadioButton')?.addEventListener('click', () => {
    const title = document.getElementById('roomTitle');
    let stationIds = [];
    try { stationIds = JSON.parse(title?.dataset?.stationIds || '[]'); } catch { /* malformed local metadata simply means no featured station */ }
    openRadioForContext({ roomId: title?.dataset?.roomId || null, stationIds });
  });
  bindMessengerBird();
  window.addEventListener('walk-poi-encounter', (event) => void import('./walk.js').then(({ recordPoiEncounter }) => recordPoiEncounter(event.detail?.poi, event.detail?.distance)));
  window.addEventListener('backpack-open-requested', openBackpack);
}

let rerouting = false;
let lastRerouteAt = 0;
let activeInstructionIndex = 1;
async function updateActiveManeuver(position) {
  const target = el('activeManeuver'); const plan = state.plannedRoute; const instructions = plan?.instructions || [];
  if (!target || !instructions.length || !state.activeWalk) return;
  if (target.dataset.routeId !== plan.id) { target.dataset.routeId = plan.id; activeInstructionIndex = 1; }
  const routeDistance = nearestRouteDistance(position, state.plannedRoute.coordinates || []);
  if (routeDistance > 75 && !rerouting && Date.now() - lastRerouteAt > 10000) {
    target.textContent = 'You are off route. Finding a new path…';
    rerouting = true;
    try {
      const plan = state.plannedRoute;
      const points = [{ lat: position.lat, lng: position.lng }, ...(plan.stops || []).map((stop) => ({ lat: stop.lat, lng: stop.lng }))];
      if (plan.routeMode === 'round-trip' || plan.routeMode === 'auto-round-trip') points.push(points[0]);
      const rerouted = await routeOnFoot(points, { city: plan.city, profile: 'ordinary_walking_beta' });
      if (rerouted.ok) {
        lastRerouteAt = Date.now();
        state.plannedRoute = { ...plan, coordinates: rerouted.coordinates, instructions: rerouted.instructions, distanceMeters: rerouted.distanceMeters, graphVersion: rerouted.graphVersion };
        target.textContent = 'Route updated. Continue walking.';
        window.dispatchEvent(new CustomEvent('walk-sketch-painted', { detail: state.plannedRoute }));
      } else target.textContent = 'You are off route. Follow the map to reconnect.';
    } finally { rerouting = false; }
    return;
  }
  while (activeInstructionIndex < instructions.length - 1) {
    const step = instructions[activeInstructionIndex]; const [lon, lat] = step.location || [];
    const distance = Math.hypot((position.lat - lat) * 111000, (position.lng - lon) * 88000);
    if (distance > 25) break;
    activeInstructionIndex += 1;
  }
  const next = instructions[activeInstructionIndex];
  if (!next) { target.textContent = 'You have arrived.'; return; }
  const [lon, lat] = next.location || [];
  const distance = Math.round(Math.hypot((position.lat - lat) * 111000, (position.lng - lon) * 88000));
  target.textContent = `${next.text} in about ${Math.max(0, distance)} m`;
}

function nearestRouteDistance(point, coordinates) {
  let best = Infinity;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1]; const b = coordinates[index];
    const dx = (b[1] - a[1]) * 111000; const dy = (b[0] - a[0]) * 88000;
    const px = (point.lat - a[0]) * 111000; const py = (point.lng - a[1]) * 88000;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - dx * t, py - dy * t));
  }
  return best;
}

function setMapWorkspace(destination = '', { toggle = true, forceOpen = false } = {}) {
  const panel = el('mapWorkspacePanel');
  if (!panel) return;
  const current = panel.dataset.destination || '';
  // Explore is the desktop landing workspace. Clicking its tab while it is
  // already selected must keep it open; otherwise the wide layout appears to
  // ignore the Explore click because boot opens this panel automatically.
  const next = !forceOpen && toggle && current === destination && !panel.classList.contains('hidden') ? '' : destination;
  panel.dataset.destination = next;
  panel.classList.toggle('hidden', !next);
  document.body.classList.toggle('map-workspace-open', Boolean(next));
  document.body.classList.toggle('draw-pane-open', next === 'draw');
  document.querySelectorAll('[data-map-destination]').forEach((button) => {
    const active = button.dataset.mapDestination === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-expanded', String(active));
  });
  document.querySelectorAll('[data-map-panel]').forEach((section) => section.classList.toggle('hidden', section.dataset.mapPanel !== next));
  if (next) el('mapWorkspaceTitle').textContent = next === 'maps' ? 'My Places' : next[0].toUpperCase() + next.slice(1);
  window.dispatchEvent(new CustomEvent('map-workspace-changed', { detail: { destination: next, open: Boolean(next) } }));
}

function bindMapWorkspace() {
  el('closeMapWorkspace')?.addEventListener('click', () => setMapWorkspace(''));
  window.addEventListener('map-workspace-open-requested', ({ detail }) => setMapWorkspace(detail?.destination ?? 'explore', { forceOpen: detail?.forceOpen === true }));
}

function closeFieldGuideMenu() {
  el('fieldGuideDropdown')?.classList.add('hidden');
  el('settingsButton')?.setAttribute('aria-expanded', 'false');
}

function toggleFieldGuideMenu() {
  const menu = el('fieldGuideDropdown');
  if (!menu) return;
  const opening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !opening);
  el('settingsButton')?.setAttribute('aria-expanded', String(opening));
}

function renderMessengerNotificationControl() {
  const button = el('messengerNotificationsButton');
  if (!button) return;
  const permission = 'Notification' in globalThis ? Notification.permission : 'unsupported';
  const enabled = state.settings.messengerNotificationsEnabled === true && permission === 'granted';
  button.textContent = permission === 'unsupported' ? 'Notifications unavailable' : permission === 'denied' ? 'Notifications blocked in browser settings' : enabled ? 'Turn notifications off' : 'Allow notifications';
  button.disabled = permission === 'unsupported' || permission === 'denied';
  button.setAttribute('aria-pressed', String(enabled));
}

function bindMessengerBird() {
  const trigger = el('messengerBirdButton');
  const menu = el('messengerBirdMenu');
  trigger?.addEventListener('click', () => {
    const opening = menu?.classList.contains('hidden');
    menu?.classList.toggle('hidden', !opening);
    trigger.setAttribute('aria-expanded', String(Boolean(opening)));
    if (opening) renderMessengerNotificationControl();
  });
  el('messengerInboxButton')?.addEventListener('click', () => {
    menu?.classList.add('hidden'); trigger?.setAttribute('aria-expanded', 'false'); openSheet('messengerInboxSheet');
  });
  el('messengerNotificationsButton')?.addEventListener('click', async () => {
    const control = el('messengerNotificationsButton');
    if (!control || control.disabled) return;
    control.disabled = true;
    try {
      let permission = Notification.permission;
      if (state.settings.messengerNotificationsEnabled && permission === 'granted') {
        state.settings.messengerNotificationsEnabled = false;
        await db.put('settings', state.settings);
        toast('Messenger Bird notifications are off.');
      } else {
        if (permission === 'default') permission = await Notification.requestPermission();
        state.settings.messengerNotificationsEnabled = permission === 'granted';
        await db.put('settings', state.settings);
        toast(permission === 'granted' ? 'Messenger Bird notifications are on.' : 'Notifications were not allowed.');
      }
    } catch {
      toast('Could not save the notification setting.');
    } finally {
      renderMessengerNotificationControl();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.messenger-stack')) { menu?.classList.add('hidden'); trigger?.setAttribute('aria-expanded', 'false'); }
  });
}

function bindSheets() {
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheets));
  el('modalBackdrop')?.addEventListener('click', closeSheets);
  el('restartCoachMarksButton')?.addEventListener('click', () => {
    closeSheets();
    restartCoachMarks();
  });
}

function togglePanel(buttonId, panelId) {
  const button = el(buttonId); const panel = el(panelId); if (!button || !panel) return;
  const opening = panel.classList.contains('hidden');
  document.querySelectorAll('.drop-panel').forEach((item) => item.classList.add('hidden'));
  document.querySelectorAll('.ink-chevron').forEach((item) => item.setAttribute('aria-expanded', 'false'));
  panel.classList.toggle('hidden', !opening); button.setAttribute('aria-expanded', String(opening));
}

function bindLocationControls() {
  el('locateButton')?.addEventListener('click', getCurrentLocation);
  el('locateChevron')?.addEventListener('click', () => togglePanel('locateChevron', 'locatePanel'));
  el('geofenceToggle').checked = state.settings.enableGeofencing !== false;
  el('geofenceRadiusSelect').value = String(state.settings.defaultGeofenceRadiusMeters || 50);
  renderGeofenceCategoryChips();
  el('geofenceToggle')?.addEventListener('change', async (event) => { state.settings.enableGeofencing = event.target.checked; await db.put('settings', state.settings); });
  el('geofenceRadiusSelect')?.addEventListener('change', async (event) => { state.settings.defaultGeofenceRadiusMeters = Number(event.target.value); await db.put('settings', state.settings); });
  el('geofenceCategoryChips')?.addEventListener('click', async (event) => {
    if (event.target.id === 'autoJournalGeofences') return;
    const chip = event.target.closest('[data-geofence-category]'); if (!chip) return;
    const selected = new Set(state.settings.geofenceCategories || []);
    selected.has(chip.dataset.geofenceCategory) ? selected.delete(chip.dataset.geofenceCategory) : selected.add(chip.dataset.geofenceCategory);
    state.settings.geofenceCategories = [...selected]; await db.put('settings', state.settings); renderGeofenceCategoryChips();
  });
}

function bindCompanionMenu() {
  window.addEventListener('companion-menu-requested', () => {
    const select = el('companionWalker');
    if (select) select.value = state.settings.companionWalker || 'inky';
    openSheet('companionSheet');
  });
  el('geofenceCategoryChips')?.addEventListener('change', async (event) => {
    if (event.target.id !== 'autoJournalGeofences') return;
    state.settings.autoJournalGeofences = event.target.checked;
    await db.put('settings', state.settings);
  });
  el('companionWalker')?.addEventListener('change', async (event) => {
    state.settings.companionWalker = event.target.value;
    await db.put('settings', state.settings);
    refreshCompanionState();
    const preview = el('companionPreviewImage');
    if (preview) preview.src = `./assets/${event.target.value === 'inky' ? 'inky-idle' : `${event.target.value}-idle`}.gif`;
  });
}

function renderWalkSketch(plan) {
  if (!plan) return;
  el('sketchTitle').textContent = plan.title || 'Walk sketch';
  el('sketchReason').textContent = plan.reason || 'A concept from named places in this installed pack.';
  el('sketchStops').innerHTML = (plan.stops || []).map((stop) => `<li>${escapeHtml(stop.name || 'Named stop')}</li>`).join('');
  const cutThrough = el('cutThroughPrompt');
  if (cutThrough) {
    const candidate = plan.cutThroughCandidate;
    cutThrough.classList.toggle('hidden', !candidate || Boolean(plan.cutThroughUsed));
    if (candidate) {
      cutThrough.innerHTML = `<span>${escapeHtml(candidate.text || 'You may be able to pass through here.')}</span> <button type="button" data-cut-through="successful_passage">Took it</button> <button type="button" data-cut-through="blocked">Blocked</button> <button type="button" data-cut-through="uncertain">Not sure</button>`;
      cutThrough.querySelectorAll('[data-cut-through]').forEach((button) => button.addEventListener('click', () => {
        recordSessionRoutingOutcome({ plan, outcome: button.dataset.cutThrough });
        plan.cutThroughUsed = true; cutThrough.classList.add('hidden');
      }, { once: true }));
    }
  }
  const instructions = el('walkInstructions');
  if (instructions) {
    const steps = plan.instructions || [];
    instructions.innerHTML = steps.length
      ? steps.map((step) => `<li>${escapeHtml(step.text)}${step.distance_m ? ` · ${Math.round(step.distance_m)} m` : ''}</li>`).join('')
      : `<li class="directions-unavailable">${escapeHtml(plan.graphStatus
        ? `No connected walking route was found (${plan.graphStatus}). Tap the map again closer to a pedestrian path.`
        : 'Turn-by-turn directions are not available for this route.')}</li>`;
  }
  el('walkSketch').classList.remove('hidden'); el('startPanel').classList.add('hidden'); el('startChevron').setAttribute('aria-expanded', 'false');
}

function bindWalkControls() {
  // Keep walk planning with the persistent bottom walk control so the map's
  // top edge stays reserved for search and location controls.
  const bottomWalkBar = el('radialStack');
  const startPanel = el('startPanel');
  if (bottomWalkBar && startPanel && !bottomWalkBar.contains(startPanel)) bottomWalkBar.append(startPanel);
  el('walkButton')?.addEventListener('click', async () => { if (!state.activeWalk) await startWalk({ routeMode: 'tracking' }); });
  el('endWalkButton')?.addEventListener('click', () => void stopWalk());
  el('startChevron')?.addEventListener('click', () => togglePanel('startChevron', 'startPanel'));
  const routeOptionsButton = el('radialRouteOptionsButton');
  routeOptionsButton?.addEventListener('click', () => {
    const panel = el('startPanel');
    const open = panel?.classList.contains('hidden');
    panel?.classList.toggle('hidden', !open);
    routeOptionsButton.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('input[name="routeMode"]').forEach((input) => input.addEventListener('change', () => {
    if (!input.checked) return;
    state.plannerEnd = null;
    state.plannerSelecting = input.value === 'point-to-point' ? 'End' : null;
    if (input.value === 'point-to-point') {
      window.dispatchEvent(new CustomEvent('primary-panel-close-requested'));
      toast('Tap the map to choose your destination.');
    }
    el('startPanel')?.classList.add('hidden');
    el('radialRouteOptionsButton')?.setAttribute('aria-expanded', 'false');
  }));
  el('generateWalkButton')?.addEventListener('click', () => void generateTimeBasedPlan());
  window.addEventListener('walk-sketch-painted', (event) => renderWalkSketch(event.detail));
  window.addEventListener('planner-point-selected', () => {
    toast('Destination selected. Sketching your point-to-point walk…');
    void generateTimeBasedPlan();
  });
  el('dismissWalkSketch')?.addEventListener('click', () => { changePlan(); el('walkSketch').classList.add('hidden'); });
  el('startPlannedWalkButton')?.addEventListener('click', async () => {
    if (!state.plannedRoute) return; lockSelectedPlanOnMap(); el('walkSketch').classList.remove('hidden');
    await startWalk({ routeMode: state.plannedRoute.routeMode || 'tracking' });
  });
  el('sendWalkPlanButton')?.addEventListener('click', () => void sendCurrentWalkPlan());
  el('saveWalkPlanButton')?.addEventListener('click', async () => {
    if (!state.plannedRoute) return;
    const title = window.prompt('Name this route', state.plannedRoute.title || 'Saved route');
    if (title === null) return;
    const notes = window.prompt('Add route notes (optional)', '') ?? '';
    try { await savePlannedRoute(state.plannedRoute, { title, notes }); toast('Route saved in My Places.'); }
    catch (error) { toast(error.message || 'Route could not be saved.'); }
  });
  el('companionButton')?.addEventListener('click', async () => {
    const current = COSTUMES.map((name) => name.toLowerCase()).indexOf(state.settings.companionWalker || 'inky'); const next = COSTUMES[(current + 1) % COSTUMES.length];
    state.settings.companionWalker = next.toLowerCase(); await db.put('settings', state.settings); refreshCompanionState();
    el('companionButton').setAttribute('aria-label', `${next} costume; tap to change`); el('companionButton').title = next; toast(next);
  });
}

function bindSearch() {
  const input = el('mapSearchInput'); const results = el('mapSearchResults');
  if (input) input.placeholder = 'Place, trail, or wildlife';
  let viewportRegionLabel = '';
  window.addEventListener('viewport-region-changed', ({ detail }) => {
    viewportRegionLabel = detail?.label || '';
    if (input && (document.activeElement !== input || !input.value.trim())) input.value = viewportRegionLabel;
  });
  input?.addEventListener('focus', () => { if (input.value === viewportRegionLabel) input.select(); });
  input?.addEventListener('blur', () => { if (!input.value.trim() || input.value === viewportRegionLabel) input.value = viewportRegionLabel; });
  let searchToken = 0;
  input?.addEventListener('input', () => {
    const query = input.value.trim();
    const token = ++searchToken;
    if (!query) { results.innerHTML = ''; results.classList.add('hidden'); return; }
    void (async () => {
      const observations = await db.all('observations').catch(() => []);
      if (token !== searchToken) return;
      let matches = localSearchHits(query, observations);
      results.innerHTML = matches.length ? matches.map(searchRowHtml).join('') : emptySearchHtml(query, true);
      results.classList.remove('hidden');
      if (matches.length >= 5) return;
      const remote = await widenSearch(query);
      if (token !== searchToken) return;
      const seen = new Set(matches.map((item) => String(item.id)));
      remote.forEach((item) => { if (!seen.has(String(item.id))) matches.push(item); });
      results.innerHTML = matches.length ? matches.slice(0, 8).map(searchRowHtml).join('') : emptySearchHtml(query, false);
    })();
  });
  results?.addEventListener('click', (event) => {
    const save = event.target.closest('[data-search-save]');
    if (save) {
      const hit = localSearchHits(input.value, []).find((item) => String(item.id) === save.dataset.searchSave);
      const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === save.dataset.searchSave) || hit || { id: save.dataset.searchSave, name: save.dataset.searchName, lat: Number(save.dataset.searchLat), lng: Number(save.dataset.searchLng) };
      if (poi) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('personal-place-create-requested', { detail: { sourcePoi: poi, location: { lat: Number(poi.lat), lng: Number(poi.lng) }, name: poi.name || 'Saved place' } }));
        results.classList.add('hidden');
      }
      return;
    }
    const button = event.target.closest('[data-search-poi]'); if (!button) return;
    const lat = Number(button.dataset.searchLat);
    const lng = Number(button.dataset.searchLng);
    const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === button.dataset.searchPoi);
    if (Number.isFinite(lat) && Number.isFinite(lng)) state.map.flyTo([lat, lng], Math.max(city().zoom + 2, 16));
    else if (poi) state.map.flyTo([poi.lat, poi.lng], Math.max(city().zoom + 2, 16));
    results.classList.add('hidden'); input.value = poi?.name || button.textContent.trim();
  });
}

function bindJournal() {
  let saveTimer;
  window.addEventListener('map-overlay-changed', ({ detail }) => {
    if (!detail.open || detail.id !== 'journalSheet') stopJournalCapture();
    if (!detail.open && detail.id === 'roomSheet') state.activeRoom = null;
  });
  el('journalNote')?.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => void saveJournalOnClose({ note: el('journalNote').value, walkId: el('journalForm').dataset.walkId }), 700); });
  window.addEventListener('journal-close-requested', (event) => void (async () => {
    clearTimeout(saveTimer);
    await saveJournalOnClose(event.detail);
    if (!state.activeWalk && state.pendingWalkPlan?.pack_id === state.activeCity) {
      const pending = state.pendingWalkPlan; state.pendingWalkPlan = null;
      setTimeout(() => paintWalkPlan(pending), 0);
    }
    window.dispatchEvent(new CustomEvent('journal-save-complete'));
  })());
  el('journalForm')?.addEventListener('submit', saveJournal);
  el('journalNote')?.addEventListener('input', (event) => {
    const count = wordCount(event.target.value); el('journalWordCount').textContent = `${count} word${count === 1 ? '' : 's'}`;
  });
  el('journalTitle')?.addEventListener('click', () => {
    const menu = el('journalNavDropdown'); const opening = menu.classList.contains('hidden'); menu.classList.toggle('hidden', !opening); el('journalTitle').setAttribute('aria-expanded', String(opening));
  });
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.addEventListener('click', () => setArchiveFilter(button.dataset.filter)));
  el('observeButton')?.addEventListener('click', () => openObservation());
  el('journalNearbyButton')?.addEventListener('click', () => {
    const target = el('nearbyList'); const opening = target.classList.contains('hidden');
    if (opening) renderNearbyPlaces();
    target.classList.toggle('hidden', !opening);
    el('journalNearbyButton').setAttribute('aria-expanded', String(opening));
  });
  el('journalTranscribeButton')?.addEventListener('click', transcribeJournal);
  el('journalRecordButton')?.addEventListener('click', () => void toggleJournalRecording());
  el('journalNavDropdown')?.addEventListener('click', (event) => {
    const kind = event.target.closest('[data-journal-jump]')?.dataset.journalJump;
    if (!kind) return;
    const target = document.querySelector(`[data-journal-kind="${kind}"]`) || (kind === 'notes' ? el('journalForm') : null);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el('journalNavDropdown').classList.add('hidden'); el('journalTitle').setAttribute('aria-expanded', 'false');
  });
  el('nearbyList')?.addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    const id = button.dataset.nearbyView || button.dataset.nearbyRoundTrip || button.dataset.nearbyRemember;
    const poi = (state.cityPois[state.activeCity] || []).find((p) => String(p.id) === id); if (!poi) return;
    if (button.dataset.nearbyRemember) window.dispatchEvent(new CustomEvent('personal-place-create-requested', { detail: { sourcePoi: poi } }));
    else if (button.dataset.nearbyRoundTrip) paintWalkPlan({ format: 'walk-wildlife-plan-v1', pack_id: state.activeCity, title: `Walk to ${poi.name}`, stop_place_ids: [poi.id] });
    else { closeSheets(); state.map.flyTo([poi.lat, poi.lng], Math.max(16, state.map.getZoom())); }
  });
  el('observationForm')?.addEventListener('submit', saveObservation);
  el('photoInput')?.addEventListener('change', (event) => { if (el('photoName')) el('photoName').textContent = event.target.files?.[0]?.name || 'Optional, stored only on this device'; });
  document.querySelectorAll('[data-observation-icon]').forEach((button) => button.addEventListener('click', () => setDraftObservationIcon(button.dataset.observationIcon)));
}

function regionCards() {
  const favorites = new Set(state.settings.favoriteRegionIds || []);
  return Object.entries(CITIES).filter(([, pack]) => pack.dataFile).sort(([leftId, left], [rightId, right]) => Number(favorites.has(rightId)) - Number(favorites.has(leftId)) || left.name.localeCompare(right.name));
}

function renderRegions() {
  const favorites = new Set(state.settings.favoriteRegionIds || []);
  el('regionList').innerHTML = regionCards().map(([id, pack]) => `<article class="region-row ${id === state.activeCity ? 'active' : ''}"><button type="button" data-region="${id}"><strong>${escapeHtml(pack.name)}</strong><small>${escapeHtml(pack.state || '')}</small></button><button class="region-star" type="button" data-region-star="${id}" aria-label="${favorites.has(id) ? 'Remove favorite' : 'Favorite'} ${escapeHtml(pack.name)}">${favorites.has(id) ? '★' : '☆'}</button></article>`).join('');
}

function bindRegions() {
  el('homeCityButton')?.addEventListener('click', () => { renderRegions(); openSheet('regionSheet'); });
  el('regionList')?.addEventListener('click', async (event) => {
    const star = event.target.closest('[data-region-star]');
    if (star) {
      const favorites = new Set(state.settings.favoriteRegionIds || []); favorites.has(star.dataset.regionStar) ? favorites.delete(star.dataset.regionStar) : favorites.add(star.dataset.regionStar);
      state.settings.favoriteRegionIds = [...favorites]; await db.put('settings', state.settings); renderRegions(); return;
    }
    const choice = event.target.closest('[data-region]'); if (!choice) return;
    await switchCity(choice.dataset.region); closeSheets();
    if (state.pendingWalkPlan?.pack_id === state.activeCity && !state.activeWalk) { const pending = state.pendingWalkPlan; state.pendingWalkPlan = null; paintWalkPlan(pending); }
  });
  window.addEventListener('city-layer-data-changed', () => { el('activeCityLabel').textContent = CITIES[state.activeCity]?.name || 'Installed region'; });
}

function bindDeviceControls() {
  el('clearDataButton')?.addEventListener('click', async () => {
    if (!confirm('Clear walks, journal notes, settings, and private places from this device?')) return;
    await db.clearAll(); localStorage.clear(); sessionStorage.clear(); location.reload();
  });
  window.addEventListener('walk-ended', () => void renderArchive());
}
