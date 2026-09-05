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
import { paintWalkPlan, sendCurrentWalkPlan } from './field-guide.js';
import { wordCount } from './reflection.js';
import { refreshCompanionState } from './companion.js';
import db from './storage.js';
import { openObservation, saveObservation, setDraftObservationIcon } from './observation.js';
import { transcribeJournal, toggleJournalRecording, stopJournalCapture } from './journal-capture.js';
import { renderNearbyPlaces, initJournalPane } from './journal-pane.js';

const COSTUMES = ['Inky', 'Fox', 'Cloud', 'Compass'];

export function initEvents() {
  initJournalPane();
  bindSheets(); bindLocationControls(); bindWalkControls(); bindSearch(); bindJournal(); bindRegions(); bindDeviceControls();
  el('settingsButton')?.addEventListener('click', openBackpack);
  el('journalButton')?.addEventListener('click', () => void openJournal());
  el('savePlaceMapButton')?.addEventListener('click', () => {
    if (!state.personalPlaceSelecting) { window.dispatchEvent(new CustomEvent('personal-place-create-requested')); return; }
    const center = state.map.getCenter();
    window.dispatchEvent(new CustomEvent('personal-place-location-selected', { detail: { lat: center.lat, lng: center.lng } }));
  });
  window.addEventListener('walk-poi-encounter', (event) => void import('./walk.js').then(({ recordPoiEncounter }) => recordPoiEncounter(event.detail?.poi, event.detail?.distance)));
  window.addEventListener('backpack-open-requested', openBackpack);
}

function bindSheets() {
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheets));
  el('modalBackdrop')?.addEventListener('click', closeSheets);
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
    const chip = event.target.closest('[data-geofence-category]'); if (!chip) return;
    const selected = new Set(state.settings.geofenceCategories || []);
    selected.has(chip.dataset.geofenceCategory) ? selected.delete(chip.dataset.geofenceCategory) : selected.add(chip.dataset.geofenceCategory);
    state.settings.geofenceCategories = [...selected]; await db.put('settings', state.settings); renderGeofenceCategoryChips();
  });
}

function renderWalkSketch(plan) {
  if (!plan) return;
  el('sketchTitle').textContent = plan.title || 'Walk sketch';
  el('sketchReason').textContent = plan.reason || 'A concept from named places in this installed pack.';
  el('sketchStops').innerHTML = (plan.stops || []).map((stop) => `<li>${escapeHtml(stop.name || 'Named stop')}</li>`).join('');
  el('walkSketch').classList.remove('hidden'); el('startPanel').classList.add('hidden'); el('startChevron').setAttribute('aria-expanded', 'false');
}

function bindWalkControls() {
  el('walkButton')?.addEventListener('click', async () => { if (!state.activeWalk) await startWalk({ routeMode: 'tracking' }); });
  el('endWalkButton')?.addEventListener('click', () => void stopWalk());
  el('startChevron')?.addEventListener('click', () => togglePanel('startChevron', 'startPanel'));
  el('generateWalkButton')?.addEventListener('click', () => void generateTimeBasedPlan());
  window.addEventListener('walk-sketch-painted', (event) => renderWalkSketch(event.detail));
  el('dismissWalkSketch')?.addEventListener('click', () => { changePlan(); el('walkSketch').classList.add('hidden'); });
  el('startPlannedWalkButton')?.addEventListener('click', async () => {
    if (!state.plannedRoute) return; lockSelectedPlanOnMap(); el('walkSketch').classList.add('hidden');
    await startWalk({ routeMode: state.plannedRoute.routeMode || 'tracking' });
  });
  el('sendWalkPlanButton')?.addEventListener('click', () => void sendCurrentWalkPlan());
  el('companionButton')?.addEventListener('click', async () => {
    const current = COSTUMES.map((name) => name.toLowerCase()).indexOf(state.settings.companionWalker || 'inky'); const next = COSTUMES[(current + 1) % COSTUMES.length];
    state.settings.companionWalker = next.toLowerCase(); await db.put('settings', state.settings); refreshCompanionState();
    el('companionButton').setAttribute('aria-label', `${next} costume; tap to change`); el('companionButton').title = next; toast(next);
  });
}

function bindSearch() {
  const input = el('mapSearchInput'); const results = el('mapSearchResults');
  if (input) input.placeholder = 'Place, trail, or wildlife';
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
  window.addEventListener('map-overlay-changed', ({ detail }) => { if (!detail.open || detail.id !== 'journalSheet') stopJournalCapture(); });
  el('journalNote')?.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => void saveJournalOnClose({ note: el('journalNote').value, walkId: el('journalForm').dataset.walkId }), 700); });
  window.addEventListener('journal-close-requested', (event) => void (async () => {
    clearTimeout(saveTimer);
    await saveJournalOnClose(event.detail);
    if (!state.activeWalk && state.pendingWalkPlan?.pack_id === state.activeCity) {
      const pending = state.pendingWalkPlan; state.pendingWalkPlan = null;
      setTimeout(() => paintWalkPlan(pending), 0);
    }
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
