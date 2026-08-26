import db from './storage.js';
import { state } from './state.js';
import { DEFAULT_SETTINGS, CITIES, POINTS_PER_MILE, POINTS_PER_OBSERVATION, POINTS_PER_NEW_HISTORY_SITE } from './constants.js';
import { normalizeProfile, sitesForProfile } from './utils.js';
import { toast, openSheet } from './ui.js';
import { initMap } from './map.js';
import { applyStaticAppearance } from './ui.js';
import { loadAllCityData, refreshCityMap } from './city.js';
import { initEvents } from './events.js';
import { renderArchive } from './archive.js';
import { setupOnline, openOnline } from './online.js';
import { initExplore } from './explore.js';
import { startDiscoveryHeadline } from './discovery.js';
import { normalizedEntitlements } from './entitlements.js';
import { initNeighborhoodDiscovery } from './neighborhoods.js';
import { restoreLocalPoiClosures } from './spatial-closure-reporting.js';
import { initFieldGuideFilters } from './field-guide.js';

export async function init() {
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
  initNeighborhoodDiscovery();
  initExplore();
  initFieldGuideFilters();

  try {
    initEvents();
  } catch (error) {
    console.error('initEvents failed:', error);
  }

  await refreshCityMap(false);
  applyStaticAppearance();
  startDiscoveryHeadline();
  await renderArchive();
  if (!state.settings.onboardingCompleted) {
    setTimeout(() => openSheet('onboardingSheet'), 250);
  }

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
    totalPoints: walks.reduce((total, walk) => total + Math.round(((walk.distanceMeters || 0) / 1609.344) * POINTS_PER_MILE), 0) + observations.length * POINTS_PER_OBSERVATION
  });
  moments.filter((moment) => moment.type === 'history' && moment.siteId).forEach((moment) => {
    const cityId = moment.city || 'fairfax';
    const ids = sitesForProfile(profile, cityId);
    if (!ids.includes(moment.siteId)) {
      profile.sitesDiscovered[cityId] = [...ids, moment.siteId];
      profile.totalPoints += POINTS_PER_NEW_HISTORY_SITE;
    }
  });
  return profile;
}
export async function loadLocalState() {
  const [savedProfile, savedSettings] = await Promise.all([db.get('profile', 'local-user'), db.get('settings', 'app-settings')]);
  state.profile = savedProfile ? normalizeProfile(savedProfile) : await createMigratedProfile();
  state.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  // Trail geofences were added after the original persisted defaults. A saved
  // profile could not have deliberately disabled this then-unavailable option.
  if (Array.isArray(state.settings.geofenceCategories) && !state.settings.geofenceCategories.includes('trail')) state.settings.geofenceCategories.push('trail');
  state.settings.entitlements = normalizedEntitlements(state.settings.entitlements);
  if (!CITIES[state.settings.activeCity] || state.settings.activeCity === 'vienna' || state.settings.activeCity === 'wolf-trap') state.settings.activeCity = 'fairfax';
  state.activeCity = state.settings.activeCity;
  await restoreLocalPoiClosures();
  await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
}
