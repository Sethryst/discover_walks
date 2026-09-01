import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { saveJournal, saveJournalOnClose, renderArchive } from './archive.js';
import { getCurrentLocation, startWalk, stopWalk } from './walk.js';
import { openBackpack, openJournal, closeSheets, openSheet, openAccountSettings, renderGeofenceCategoryChips, setArchiveFilter, toast } from './ui.js';
import { city, searchPois } from './poi.js';
import { switchCity } from './city.js';
import { generateTimeBasedPlan, lockSelectedPlanOnMap, changePlan } from './planner.js';
import { downloadCurrentWalkPlan, normalizeWalkPlan, paintWalkPlan, sendCurrentWalkPlan } from './field-guide.js';
import { wordCount } from './reflection.js';
import { refreshCompanionState } from './companion.js';
import { initBackupControls } from './backup.js';
import { openOnline, renderOnline, signIn, signUp, signInWithPasskey, registerPasskey, syncProfile, createOnlineProfile, updateAccountUsername, updateAccountEmail, updateAccountPassword } from './online.js';
import db from './storage.js';

const COSTUMES = ['Inky', 'Fox', 'Cloud', 'Compass'];

export function initEvents() {
  initBackupControls();
  bindSheets(); bindLocationControls(); bindWalkControls(); bindSearch(); bindJournal(); bindRegions(); bindShareSettings(); bindOnlineControls(); bindDeviceControls();
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
  input?.addEventListener('input', () => {
    const matches = input.value.trim() ? searchPois(input.value).slice(0, 7) : [];
    results.innerHTML = matches.map((poi) => `<button type="button" data-search-poi="${escapeHtml(String(poi.id))}">${escapeHtml(poi.name || 'Named place')}</button>`).join('');
    results.classList.toggle('hidden', !matches.length);
  });
  results?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-search-poi]'); if (!button) return;
    const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === button.dataset.searchPoi);
    if (poi) state.map.flyTo([poi.lat, poi.lng], Math.max(city().zoom + 2, 16));
    results.classList.add('hidden'); input.value = poi?.name || '';
  });
}

function bindJournal() {
  window.addEventListener('journal-close-requested', (event) => void (async () => {
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
    const history = el('journalHistory'); const opening = history.classList.contains('hidden'); history.classList.toggle('hidden', !opening); el('journalTitle').setAttribute('aria-expanded', String(opening));
  });
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.addEventListener('click', () => setArchiveFilter(button.dataset.filter)));
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
  el('onboardingCitySelect').innerHTML = regionCards().map(([id, pack]) => `<option value="${id}">${escapeHtml(pack.name)}, ${escapeHtml(pack.state || '')}</option>`).join('');
  el('onboardingCitySelect').value = state.activeCity;
  el('saveOnboardingButton')?.addEventListener('click', async () => { state.settings.onboardingCompleted = true; await db.put('settings', state.settings); await switchCity(el('onboardingCitySelect').value); closeSheets(); });
  window.addEventListener('city-layer-data-changed', () => { el('activeCityLabel').textContent = CITIES[state.activeCity]?.name || 'Installed region'; });
}

function bindShareSettings() {
  el('defaultPinVisibility').value = state.settings.defaultPinVisibility || 'private'; el('shareAttribution').value = state.settings.shareAttribution || '';
  el('defaultPinVisibility')?.addEventListener('change', async (event) => { state.settings.defaultPinVisibility = event.target.value; await db.put('settings', state.settings); });
  el('shareAttribution')?.addEventListener('change', async (event) => { state.settings.shareAttribution = event.target.value.trim(); await db.put('settings', state.settings); });
  el('walkPlanImportInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const plan = normalizeWalkPlan(await file.text()); if (state.activeWalk) { state.pendingWalkPlan = plan; toast('Walk plan queued until this walk ends.'); } else paintWalkPlan(plan); }
    catch (error) { toast(error.message || 'That walk plan could not be opened.'); }
    event.target.value = '';
  });
  el('downloadWalkPlanButton')?.addEventListener('click', downloadCurrentWalkPlan);
  const friends = (state.online.leaderboard || []).map((friend) => friend.username).filter(Boolean);
  el('friendSharePicker').innerHTML = friends.map((name) => `<span class="poi-chip">@${escapeHtml(name)}</span>`).join('');
  renderShareAccount();
  window.addEventListener('share-panel-render-requested', renderShareAccount);
  window.addEventListener('online-profile-changed', renderShareAccount);
}

function renderShareAccount() {
  const button = el('openOnlineButton');
  if (!button) return;
  let panel = el('shareAccountPanel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'shareAccountPanel';
    panel.className = 'share-account-panel';
    panel.setAttribute('aria-live', 'polite');
    button.closest('.share-actions')?.after(panel);
  }
  const signedIn = Boolean(state.online.session);
  button.textContent = signedIn ? 'Account' : 'Sign in';
  if (!signedIn) {
    panel.innerHTML = '<p class="sheet-intro">Sign in to add a username, sync aggregate stats, or use encrypted backup.</p>';
    return;
  }
  panel.innerHTML = `<p class="sheet-kicker">ACCOUNT</p><form data-share-account="username"><label>Username<input maxlength="24" value="${escapeHtml(state.online.remoteProfile?.username || '')}" /></label><button class="secondary-button" type="submit">Update username</button></form><form data-share-account="email"><label>Email<input type="email" value="${escapeHtml(state.online.session.user?.email || '')}" /></label><button class="secondary-button" type="submit">Update email</button></form><form data-share-account="password"><label>Password<input type="password" minlength="6" autocomplete="new-password" /></label><button class="secondary-button" type="submit">Update password</button></form>`;
  panel.querySelector('[data-share-account="username"]')?.addEventListener('submit', updateAccountUsername);
  panel.querySelector('[data-share-account="email"]')?.addEventListener('submit', updateAccountEmail);
  panel.querySelector('[data-share-account="password"]')?.addEventListener('submit', updateAccountPassword);
}

function bindOnlineControls() {
  el('openOnlineButton')?.addEventListener('click', () => void openOnline()); el('signInButton')?.addEventListener('click', signIn); el('passkeySignInButton')?.addEventListener('click', signInWithPasskey); el('signUpButton')?.addEventListener('click', signUp);
  el('usernameForm')?.addEventListener('submit', createOnlineProfile); el('syncNowButton')?.addEventListener('click', async () => { await syncProfile(); await renderOnline(); }); el('accountSettingsButton')?.addEventListener('click', openAccountSettings); el('registerPasskeyButton')?.addEventListener('click', registerPasskey);
  el('accountUsernameForm')?.addEventListener('submit', updateAccountUsername); el('accountEmailForm')?.addEventListener('submit', updateAccountEmail); el('accountPasswordForm')?.addEventListener('submit', updateAccountPassword);
}

function bindDeviceControls() {
  el('clearDataButton')?.addEventListener('click', async () => {
    if (!confirm('Clear walks, journal notes, settings, and private places from this device?')) return;
    await db.clearAll(); localStorage.clear(); sessionStorage.clear(); location.reload();
  });
  window.addEventListener('walk-ended', () => void renderArchive());
}
