import db from './storage.js';
import { state } from './state.js';
import { DEFAULT_SETTINGS, CITIES } from './constants.js';
import { normalizeProfile, sitesForProfile } from './utils.js';
import { toast, openSheet } from './ui.js';
import { initMap } from './map.js';
import { applyStaticAppearance } from './ui.js';
import { loadAllCityData, refreshCityMap } from './city.js';
import { initEvents } from './events.js';
import { renderArchive } from './archive.js';
import { setupOnline, openOnline } from './online.js';
import { normalizedEntitlements } from './entitlements.js';
import { restoreLocalPoiClosures } from './spatial-closure-reporting.js';
import { initFieldGuideFilters } from './field-guide.js';
import { recoverWalkDraft } from './walk.js';
import { initPersonalPlaces } from './personal-places.js';
import { initLayerSystem } from './layer-system.js';
import { chooseClosestCityIfPermitted } from './discovery.js';

export async function init() {
  const splash = document.getElementById('appSplash');
  const dismissSplash = () => splash?.classList.add('app-splash--done');
  setTimeout(dismissSplash, 2500);
  try {
    await db.open();
    await loadLocalState();
    const requestedCity = new URLSearchParams(globalThis.location?.search || '').get('city');
    if (requestedCity && CITIES[requestedCity]) {
      state.activeCity = requestedCity;
      state.settings.activeCity = requestedCity;
      await db.put('settings', state.settings);
    }
    await loadAllCityData();
  } catch (error) {
    console.error(error);
    toast('Local storage or places data could not open in this browser.');
    return;
  }

  initMap();
  await initPersonalPlaces();
  await initLayerSystem();
  initFieldGuideFilters();

  try {
    initEvents();
  } catch (error) {
    console.error('initEvents failed:', error);
  }

  await refreshCityMap(false);
  await chooseClosestCityIfPermitted();
  await recoverWalkDraft();
  applyStaticAppearance();
  await renderArchive();
  if (!state.settings.onboardingCompleted && !state.activeWalk) {
    setTimeout(() => openSheet('onboardingSheet'), 250);
  }

  if (splash) requestAnimationFrame(dismissSplash);

  try {
    await setupOnline();

    if (state.online.session && !state.online.remoteProfile?.username) {
      await openOnline();
      toast('Signed in! Choose a username to finish setup.');
    }
  } catch (error) {
    console.warn('Online mode unavailable:', error.message);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

// Kept local to boot so an older cached discovery module cannot prevent the
// whole application from starting during a service-worker rollout.
export async function createMigratedProfile() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  const profile = normalizeProfile({
    walksCompleted: walks.length,
    milesTotal: walks.reduce((total, walk) => total + ((walk.distanceMeters || 0) / 1609.344), 0),
    observationsLogged: observations.length,
    sitesDiscovered: {},
    totalPoints: 0
  });
  moments.filter((moment) => moment.type === 'history' && moment.siteId).forEach((moment) => {
    const cityId = moment.city || state.activeCity || Object.keys(CITIES).find((id) => CITIES[id]?.dataFile);
    const ids = sitesForProfile(profile, cityId);
    if (!ids.includes(moment.siteId)) {
      profile.sitesDiscovered[cityId] = [...ids, moment.siteId];
    }
  });
  return profile;
}
export async function loadLocalState() {
  const [savedProfile, savedSettings, savedWalks] = await Promise.all([db.get('profile', 'local-user'), db.get('settings', 'app-settings'), db.all('walks')]);
  state.profile = savedProfile ? normalizeProfile(savedProfile) : await createMigratedProfile();
  state.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  if (!Array.isArray(state.settings.geofenceCategories) || !state.settings.geofenceCategories.some((id) => ['recreation', 'cuisine'].includes(id))) state.settings.geofenceCategories = ['recreation', 'cuisine'];
  state.settings.entitlements = normalizedEntitlements(state.settings.entitlements);
  if (!CITIES[state.settings.activeCity] || !CITIES[state.settings.activeCity]?.dataFile) state.settings.activeCity = Object.keys(CITIES).find((cityId) => CITIES[cityId]?.dataFile);
  state.activeCity = state.settings.activeCity;
  state.walks = savedWalks;
  state.knownTrackPoints = savedWalks.flatMap((walk) => (walk.points || []).filter((_, index) => index % 5 === 0));
  await restoreLocalPoiClosures();
  await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
}
