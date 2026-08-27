import { state } from './state.js';
import { CITIES, DEFAULT_PROFILE, DEFAULT_SETTINGS, GEOFENCE_CATEGORIES } from './constants.js';
import { el, normalizeProfile, uid } from './utils.js';
import { initBackupControls } from './backup.js';
import { openWalkDetail, saveHistoryMoment, saveJournal, saveQuickJournal, renderArchive } from './archive.js';
import { getCurrentLocation, startWalk, stopWalk, togglePauseWalk, updateWalkDisplay } from './walk.js';
import { openObservation, saveObservation, setDraftObservationIcon } from './observation.js';
import { openJournal, closeSheets, openSheet, openAccountSettings, openFiltersSheet, openProfile, renderGeofenceCategoryChips, setArchiveFilter, showView, toast } from './ui.js';
import { city, citySites, displayPoiName, geofenceCategoriesForCity, renderPoiTagFilters, renderCityPois, showHistory, savePlaceMemory, searchPois, searchOsm } from './poi.js';
import { syncProfile, renderOnline, openOnline, signIn, signUp, signInWithGoogle, createOnlineProfile, updateAccountUsername, updateAccountPhone, updateAccountEmail, updateAccountPassword } from './online.js';
import { refreshCityMap, switchCity } from './city.js';
import { renderProfile } from './profile.js';
import { toggleFavoriteRegion } from './region-favorites.js';
import db from './storage.js';
import { openDiscoverGroup, renderExplorePlaces, setExploreTab } from './explore.js';
import { nearestCityFromCurrentLocation, renderDiscoveryHeadline } from './discovery.js';
import { showCuratedRoute } from './routes.js';
import { generateTimeBasedPlan, previewTimeBasedPlan, choosePlan, changePlan, setPlanningMode, lockSelectedPlanOnMap, togglePlanVisibility, draftWalkFromText } from './planner.js';
import { wordCount } from './reflection.js';
import { onboardingProgress, onboardingValue } from './onboarding.js';
import { renderNearbyPlaces, setJournalSheetState } from './journal-pane.js';

export function initEvents() {
  initBackupControls();
  el('archiveList').addEventListener('click', (event) => { const card = event.target.closest('[data-walk-id]'); if (card) openWalkDetail(card.dataset.walkId); });
  el('archiveList').addEventListener('keydown', (event) => { const card = event.target.closest('[data-walk-id]'); if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openWalkDetail(card.dataset.walkId); } });
  el('locateButton').addEventListener('click', getCurrentLocation);
  el('homeCityButton').addEventListener('click', () => openRegionChooser());
  el('walkButton').addEventListener('click', () => state.activeWalk ? openSheet('routeSheet') : openSheet('startWalkSheet'));
  el('activeRouteButton').addEventListener('click', () => { updateWalkDisplay(); openSheet('routeSheet'); });
  el('routePauseButton').addEventListener('click', togglePauseWalk);
  el('routeEndButton').addEventListener('click', () => { closeSheets(); stopWalk(); });
  el('planWalkButton').addEventListener('click', async () => { setPlanningMode(true); openSheet('planWalkSheet'); await generateTimeBasedPlan(); });
  el('startWalkSheet').addEventListener('click', async (event) => {
    const choice = event.target.closest('[data-start-walk-mode]'); if (!choice) return;
    state.plannerEnd = null;
    const input = document.querySelector(`input[name="routeMode"][value="${choice.dataset.startWalkMode}"]`); if (input) input.checked = true;
    closeSheets(); setPlanningMode(true); openSheet('planWalkSheet'); await generateTimeBasedPlan();
  });
  el('choosePlanStartButton').addEventListener('click', () => { state.plannerSelecting = 'Start'; toast('Planning mode: tap a starting point.'); closeSheets(); showView('map'); });
  el('choosePlanEndButton').addEventListener('click', () => { state.plannerSelecting = 'End'; toast('Planning mode: tap a destination.'); closeSheets(); showView('map'); });
  window.addEventListener('planner-point-selected', async () => { openSheet('planWalkSheet'); await generateTimeBasedPlan(); });
  window.addEventListener('planner-route-selected', () => openSheet('planWalkSheet'));
  el('showPlanOptionsOnMap').addEventListener('click', () => { closeSheets(); showView('map'); previewTimeBasedPlan({ fit: true }); toast('Tap a colored route on the map to select it.'); });
  el('planOptions').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-route-toggle]'); if (toggle) { togglePlanVisibility(toggle.dataset.routeToggle, toggle.checked); return; }
    const option = event.target.closest('[data-plan-option]'); if (option) choosePlan(option.dataset.planOption);
    if (event.target.closest('[data-change-plan]')) changePlan();
    if (event.target.closest('[data-quick-retry="shorter"]')) { const time = document.querySelector('input[name="walkTime"][value="15"]'); const mode = document.querySelector('input[name="routeMode"][value="round-trip"]'); if (time) time.checked = true; if (mode) mode.checked = true; void generateTimeBasedPlan(); }
  });
  el('draftTextWalkButton').addEventListener('click', () => void draftWalkFromText(el('textWalkInput').value));
  el('startPlannedWalkButton').addEventListener('click', async () => { if (!state.plannedRoute) { toast('Choose a route on the map before starting your walk.'); return; } if (!lockSelectedPlanOnMap()) { toast('A walkable road route could not be found.'); return; } setPlanningMode(false); closeSheets(); showView('map'); startWalk(); });
  el('planWalkSheet').addEventListener('change', (event) => { if (event.target.matches('input[name="walkTime"], input[name="routeMode"]')) void generateTimeBasedPlan(); });
  el('planWalkSheet').addEventListener('click', (event) => { const chip = event.target.closest('[data-planner-tag]'); if (!chip) return; chip.classList.toggle('active'); void generateTimeBasedPlan(); });
  el('curatedRoutesList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-curated-route]'); if (!button) return;
    const route = showCuratedRoute(button.dataset.curatedRoute);
    if (!route) return;
    showView('map');
    toast(`${route.title} previewed. Check the official route page before you go.`);
  });
  el('showPlacesOnMapButton').addEventListener('click', () => { showView('map'); renderCityPois(); });
  el('browseDiscoverButton').addEventListener('click', () => { showView('explore'); setExploreTab('routes'); renderExplorePlaces(); });
  el('discoverWays').addEventListener('click', (event) => { const button = event.target.closest('[data-discover-group]'); if (!button) return; showView('explore'); openDiscoverGroup(button.dataset.discoverGroup); });
  el('exploreEvents').addEventListener('click', (event) => { const button = event.target.closest('[data-civic-view]'); if (button) showView(button.dataset.civicView); });
  el('explorePlacesList').addEventListener('click', (event) => {
    const item = event.target.closest('[data-place-id]'); if (!item) return;
    const poi = (state.cityPois[state.activeCity] || []).find((place) => place.id === item.dataset.placeId);
    if (!poi) return; showView('map'); state.map.flyTo([poi.lat, poi.lng], Math.max(city().zoom + 2, 16));
  });
  el('addObservationButton').addEventListener('click', () => openObservation());
  el('quickJournalForm').addEventListener('submit', saveQuickJournal);
  el('composerPhotoButton').addEventListener('click', () => el('quickJournalPhoto').click());
  el('quickJournalPhoto').addEventListener('change', (event) => { el('quickJournalPhotoName').textContent = event.target.files[0]?.name || 'Private on this device'; setJournalSheetState('half'); });
  el('composerNearbyButton').addEventListener('click', () => { renderNearbyPlaces(); openSheet('nearbySheet'); });
  el('nearbyList').addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-nearby-view]');
    const routeButton = event.target.closest('[data-nearby-round-trip]');
    const rememberButton = event.target.closest('[data-nearby-remember]');
    const id = viewButton?.dataset.nearbyView || routeButton?.dataset.nearbyRoundTrip || rememberButton?.dataset.nearbyRemember;
    if (!id) return;
    const poi = (state.cityPois[state.activeCity] || []).find((place) => place.id === id); if (!poi) return;
    if (rememberButton) {
      await savePlaceMemory(poi.id);
      await db.put('moments', { id: uid('moment'), type: 'place', title: displayPoiName(poi), note: 'Place remembered from Nearby.', siteId: poi.id, city: state.activeCity, createdAt: new Date().toISOString(), location: { lat: poi.lat, lng: poi.lng }, source: poi.source });
      await renderArchive(); toast('Place remembered in your journal.'); return;
    }
    closeSheets(); showView('map'); state.map.flyTo([poi.lat, poi.lng], Math.max(city().zoom + 2, 16));
    if (routeButton) {
      state.plannerEnd = poi;
      const input = document.querySelector('input[name="routeMode"][value="round-trip"]'); if (input) input.checked = true;
      setPlanningMode(true); openSheet('planWalkSheet'); await generateTimeBasedPlan();
    } else setJournalSheetState('collapsed');
  });
  el('journalButton').addEventListener('click', () => openJournal());
  el('demoButton').addEventListener('click', () => { const site = citySites()[0]; state.map.flyTo([site.lat, site.lng], Math.max(city().zoom + 2, 16)); setTimeout(() => showHistory(site, 28), 350); });
  el('settingsButton').addEventListener('click', () => openSheet('infoSheet'));
  el('advancedAppearanceForm').addEventListener('submit', async (event) => { event.preventDefault(); state.settings.staticAppearance = { headlineTitle: el('advancedHeadlineTitle').value.trim() || 'A walk with a purpose', headlineIcon: el('advancedHeadlineIcon').value, developerName: el('developerName').value.trim(), developerUrl: el('developerUrl').value.trim() }; await db.put('settings', state.settings); const { applyStaticAppearance } = await import('./ui.js'); applyStaticAppearance(); toast('Appearance saved on this device.'); });
  el('fieldEditionButton').addEventListener('click', () => openSheet('fieldEditionSheet'));
  el('partnerAccessButton').addEventListener('click', () => { openSheet('fieldEditionSheet'); toast('Partner access will be verified by your institution in a production release.'); });
  el('profileJournalButton').addEventListener('click', () => openJournal());
  el('filtersButton').addEventListener('click', openFiltersSheet);
  el('dismissHistoryButton').addEventListener('click', closeSheets); el('saveHistoryMomentButton').addEventListener('click', saveHistoryMoment);
  el('saveHistoryMomentButton').addEventListener('click', () => {
  if (state.currentSite) savePlaceMemory(state.currentSite.id, el('historyNoteInput').value.trim());
});

let osmSearchTimer = null;
el('poiSearchInput').addEventListener('input', (event) => {
  const query = event.target.value;
  clearTimeout(osmSearchTimer);
  const localResults = searchPois(query);
  const list = el('poiSearchResults');

  if (localResults.length) {
    list.classList.remove('hidden');
    list.innerHTML = localResults.map((poi) => `<button type="button" data-poi-id="${poi.id}">${displayPoiName(poi)}</button>`).join('');
    return;
  }

  if (!query.trim()) { list.classList.add('hidden'); list.innerHTML = ''; return; }

  list.classList.remove('hidden');
  list.innerHTML = '<div class="search-loading">Searching map…</div>';
  osmSearchTimer = setTimeout(async () => {
    const osmResults = await searchOsm(query);
    if (el('poiSearchInput').value !== query) return; // stale response, user kept typing
    list.innerHTML = osmResults.length
      ? osmResults.map((poi) => `<button type="button" data-osm-lat="${poi.lat}" data-osm-lng="${poi.lng}">${poi.name} <small>via OpenStreetMap</small></button>`).join('')
      : '<div class="search-loading">No results</div>';
  }, 400);
});

el('poiSearchResults').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.poiId) {
    const poi = (state.cityPois[state.activeCity] || []).find((p) => p.id === button.dataset.poiId);
    if (!poi) return;
    state.map.flyTo([poi.lat, poi.lng], Math.max(city().zoom + 2, 16));
    if ((poi.tags || []).includes('history')) setTimeout(() => showHistory(poi, 0), 350);
  } else if (button.dataset.osmLat) {
    state.map.flyTo([parseFloat(button.dataset.osmLat), parseFloat(button.dataset.osmLng)], 17);
  }
  el('poiSearchResults').classList.add('hidden');
  el('poiSearchInput').value = '';
});
el('poiSearchResults').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.poiId) {
    const poi = (state.cityPois[state.activeCity] || []).find((p) => p.id === button.dataset.poiId);
    if (!poi) return;
    state.map.flyTo([poi.lat, poi.lng], Math.max(city().zoom + 2, 16));
    if ((poi.tags || []).includes('history')) setTimeout(() => showHistory(poi, 0), 350);
  } else if (button.dataset.osmLat) {
    state.map.flyTo([parseFloat(button.dataset.osmLat), parseFloat(button.dataset.osmLng)], 17);
  }
  el('poiSearchResults').classList.add('hidden');
  el('poiSearchInput').value = '';
});
  el('observationForm').addEventListener('submit', saveObservation); el('journalForm').addEventListener('submit', saveJournal);
  el('journalPromptChoices').addEventListener('click', (event) => { const button = event.target.closest('[data-journal-prompt]'); if (!button) return; el('journalForm').dataset.prompt = button.dataset.journalPrompt; el('journalPrompt').textContent = button.dataset.journalPrompt; document.querySelectorAll('[data-journal-prompt]').forEach((choice) => { const selected = choice === button; choice.classList.toggle('active', selected); choice.setAttribute('aria-pressed', String(selected)); }); el('journalNote').focus(); });
  el('journalNote').addEventListener('input', (event) => { const count = wordCount(event.target.value); el('journalWordCount').textContent = `${count} word${count === 1 ? '' : 's'}`; });
  el('observationIconPicker').addEventListener('click', (event) => { const button = event.target.closest('[data-observation-icon]'); if (button) setDraftObservationIcon(button.dataset.observationIcon); });
  el('photoInput').addEventListener('change', (event) => { el('photoName').textContent = event.target.files[0]?.name || 'Optional, stored only on this device'; });
  const onboardingCity = el('onboardingCitySelect');
  const cityOptions = () => Object.entries(CITIES).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, item]) => `<option value="${id}">${item.name}, ${item.state}</option>`).join('');
  onboardingCity.innerHTML = cityOptions(); onboardingCity.value = state.activeCity;
  const quickCity = el('quickCitySelect'); quickCity.innerHTML = cityOptions(); quickCity.value = state.activeCity;
  let onboardingInterests = [];
  let onboardingStep = 'region';
  const setOnboardingStep = (step) => {
    onboardingStep = step;
    document.querySelectorAll('[data-onboarding-step]').forEach((section) => section.classList.toggle('hidden', section.dataset.onboardingStep !== step));
    renderOnboardingValue();
  };
  const renderOnboardingValue = () => {
    const id = onboardingCity.value;
    const progress = onboardingProgress(onboardingInterests, onboardingStep);
    el('onboardingValuePreview').querySelector('span').textContent = onboardingValue(CITIES[id]?.name || 'your region', onboardingInterests);
    el('onboardingProgressText').textContent = `${progress} of 3 ready`;
    el('onboardingProgressBar').style.width = `${(progress / 3) * 100}%`;
    el('onboardingInterestCount').textContent = `${onboardingInterests.length} of 3 chosen`;
    document.querySelectorAll('[data-onboarding-interest]').forEach((button) => button.classList.toggle('active', onboardingInterests.includes(button.dataset.onboardingInterest)));
  };
  const finishOnboarding = async (applyChoices = false) => {
    const nextCity = onboardingCity.value;
    state.settings.onboardingCompleted = true;
    if (applyChoices) state.settings.favoriteCategories = onboardingInterests;
    await db.put('settings', state.settings);
    if (CITIES[nextCity] && nextCity !== state.activeCity) await switchCity(nextCity);
    closeSheets(); renderProfile();
    showView('map');
    toast('You’re ready. Start a walk, or write something in your journal.');
  };
  const openRegionChooser = () => { quickCity.value = state.activeCity; openSheet('regionSheet'); };
  el('applyQuickCityButton').addEventListener('click', async () => { const nextCity = quickCity.value; if (CITIES[nextCity] && nextCity !== state.activeCity) await switchCity(nextCity); closeSheets(); toast(`${CITIES[state.activeCity].name} is now your starting region.`); });
  el('reopenOnboardingButton').addEventListener('click', () => { onboardingCity.value = state.activeCity; onboardingInterests = [...(state.settings.favoriteCategories || [])].slice(0, 3); setOnboardingStep('region'); openSheet('onboardingSheet'); });
  el('onboardingInterestChips').addEventListener('click', (event) => { const button = event.target.closest('[data-onboarding-interest]'); if (!button) return; const id = button.dataset.onboardingInterest; onboardingInterests = onboardingInterests.includes(id) ? onboardingInterests.filter((item) => item !== id) : onboardingInterests.length < 3 ? [...onboardingInterests, id] : onboardingInterests; if (onboardingInterests.length === 3 && !onboardingInterests.includes(id)) toast('Choose up to three for now. You can add more later in Journal.'); renderOnboardingValue(); });
  onboardingCity.addEventListener('change', renderOnboardingValue); renderOnboardingValue();
  el('onboardingRegionNextButton').addEventListener('click', () => void finishOnboarding(false));
  el('onboardingInterestBackButton').addEventListener('click', () => setOnboardingStep('region'));
  el('onboardingInterestNextButton').addEventListener('click', () => setOnboardingStep('ready'));
  el('onboardingReadyBackButton').addEventListener('click', () => setOnboardingStep('interests'));
  el('useOnboardingLocationButton').addEventListener('click', async () => { const button = el('useOnboardingLocationButton'); button.disabled = true; el('onboardingLocationNote').textContent = 'Finding the nearest available regional center…'; const closest = await nearestCityFromCurrentLocation(); button.disabled = false; if (!closest) { el('onboardingLocationNote').textContent = 'Location was not available. Your selected regional center still works without it.'; return; } onboardingCity.value = closest.id; el('onboardingLocationNote').textContent = `${CITIES[closest.id].name} is the nearest available regional center. You can change it any time.`; renderOnboardingValue(); });
  el('skipOnboardingButton').addEventListener('click', () => void finishOnboarding(false));
  el('saveOnboardingButton').addEventListener('click', () => void finishOnboarding(true));
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => { const wasPlanner = button.closest('#planWalkSheet'); closeSheets(); if (wasPlanner) setPlanningMode(false); }));
  el('modalBackdrop').addEventListener('click', closeSheets);
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.addEventListener('click', () => setArchiveFilter(button.dataset.filter)));
  el('citySelect').addEventListener('change', (event) => switchCity(event.target.value));
  el('goOnlineButton').addEventListener('click', openOnline);
  el('signInButton').addEventListener('click', signIn);
el('googleSignInButton').addEventListener('click', signInWithGoogle);
el('signUpButton').addEventListener('click', signUp);
el('usernameForm').addEventListener('submit', createOnlineProfile);
  el('syncNowButton').addEventListener('click', async () => { try { await syncProfile(); await renderOnline(); toast('Aggregate stats synced.'); } catch (error) { toast(error.message || 'Could not sync right now.'); } });
el('accountSettingsButton').addEventListener('click', openAccountSettings);
el('accountUsernameForm').addEventListener('submit', updateAccountUsername);
el('accountEmailForm').addEventListener('submit', updateAccountEmail);
el('accountPasswordForm').addEventListener('submit', updateAccountPassword);
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    closeSheets();
    if (button.dataset.view === 'profile') openProfile();
    else if (button.dataset.view === 'fieldGuide') showView('fieldGuide');
    else if (button.dataset.view === 'explore') showView('explore');
    else if (button.dataset.view === 'vote' || button.dataset.view === 'volunteer') showView(button.dataset.view);
    else showView('map');
  }));
  document.querySelectorAll('[data-discover-lens]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.discoverLens)));
  document.querySelectorAll('[data-back-discover]').forEach((button) => button.addEventListener('click', () => showView('explore')));
  el('clearDataButton').addEventListener('click', async () => {
    if (!confirm("Clear every locally saved walk, reflection, observation, and personal profile record on this device? This can't be undone.")) return;
    await db.clearAll();
    state.profile = normalizeProfile(DEFAULT_PROFILE); state.settings = { ...DEFAULT_SETTINGS }; state.activeCity = 'fairfax';
    await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
    closeSheets(); await refreshCityMap(true); renderArchive(); toast('Local journal data cleared.');
  });
  el('poiTagFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-poi-tag]'); if (!button) return;
    const id = button.dataset.poiTag;
    state.poiTags.has(id) ? state.poiTags.delete(id) : state.poiTags.add(id);
    renderPoiTagFilters();
  });
  el('clearPoiFiltersButton').addEventListener('click', () => { state.poiTags.clear(); renderPoiTagFilters(); renderCityPois(); });
  el('applyFiltersButton').addEventListener('click', () => { renderCityPois(); closeSheets(); });
  el('trailFeatureButton').addEventListener('click', () => {
    const bounds = state.trailLayer.getBounds();
    if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28] });
  });
  if (el('geofenceToggle')) {
    el('geofenceToggle').addEventListener('change', async (event) => {
      state.settings.enableGeofencing = event.target.checked;
      await db.put('settings', state.settings);
      renderProfile();
    });
  }
  if (el('geofenceRadiusSelect')) {
    el('geofenceRadiusSelect').addEventListener('change', async (event) => {
      state.settings.defaultGeofenceRadiusMeters = Number(event.target.value) || 50;
      await db.put('settings', state.settings);
    });
  }
  if (el('geofenceCategoryChips')) {
    el('geofenceCategoryChips').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-geofence-category]'); if (!button) return;
      const id = button.dataset.geofenceCategory;
      const available = geofenceCategoriesForCity();
      const categories = new Set(state.settings.geofenceCategories || (available.length ? available : GEOFENCE_CATEGORIES).map(([c]) => c));
      categories.has(id) ? categories.delete(id) : categories.add(id);
      state.settings.geofenceCategories = [...categories];
      await db.put('settings', state.settings);
      renderGeofenceCategoryChips();
    });
  }
  el('favoriteCategoryChips').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-favorite-category]'); if (!button) return;
    const favorites = new Set(state.settings.favoriteCategories || []);
    const id = button.dataset.favoriteCategory;
    favorites.has(id) ? favorites.delete(id) : favorites.add(id);
    state.settings.favoriteCategories = [...favorites];
    await db.put('settings', state.settings);
    el('preferenceSaveStatus').textContent = 'Saved on this device';
    renderProfile();
    renderDiscoveryHeadline();
  });
  el('toggleFavoriteRegionButton').addEventListener('click', async () => {
    const id = el('favoriteRegionSelect').value; if (!id) return;
    if (await toggleFavoriteRegion(state.settings, id)) { await db.put('settings', state.settings); renderProfile(); }
  });
  el('favoriteRegionChips').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-favorite-region]'); if (!button) return;
    if (await toggleFavoriteRegion(state.settings, button.dataset.favoriteRegion)) { await db.put('settings', state.settings); renderProfile(); }
  });
}
