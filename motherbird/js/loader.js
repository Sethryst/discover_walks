import db from './storage.js';
import { state } from './state.js';
import { DEFAULT_SETTINGS, CITIES, DEFAULT_CITY_ID } from './constants.js';
import { normalizeProfile, sitesForProfile } from './utils.js';
import { toast } from './ui.js';
import { initMap } from './map.js';
import { applyStaticAppearance } from './ui.js';
import { loadAllCityData, refreshCityMap } from './city.js';
import { initEvents } from './events.js';
import { renderArchive } from './archive.js';
import { normalizedEntitlements } from './entitlements.js';
import { restoreLocalPoiClosures } from './spatial-closure-reporting.js';
import { initFieldGuideFilters } from './field-guide.js';
import { recoverWalkDraft } from './walk.js';
import { initPersonalPlaces } from './personal-places.js';
import { initLayerSystem } from './layer-system.js';
import { initMapPaint } from './map-paint.js';
import { activateInstalledRegionRuntime } from './installed-region-runtime.js';
import { initCountyAdditions } from './county-additions.js';
import { applyOfflineBootConditions } from './offline-view.js';
import { migrateLegacyJournalAudio } from './journal-capture.js';
import { initOnlinePane } from './online-pane.js';

export async function init() {
  const splash = document.getElementById('appSplash');
  const pinSplashToVisibleViewport = () => {
    if (!splash || splash.classList.contains('app-splash--done')) return;
    const viewport = globalThis.visualViewport;
    const height = Math.round(viewport?.height || globalThis.innerHeight || 0);
    const width = Math.round(viewport?.width || globalThis.innerWidth || 0);
    const top = Math.round(viewport?.offsetTop || 0);
    const left = Math.round(viewport?.offsetLeft || 0);
    if (height > 0) splash.style.height = `${height}px`;
    if (width > 0) splash.style.width = `${width}px`;
    splash.style.top = `${top}px`;
    splash.style.left = `${left}px`;
    splash.style.right = 'auto';
    splash.style.bottom = 'auto';
  };
  pinSplashToVisibleViewport();
  globalThis.visualViewport?.addEventListener('resize', pinSplashToVisibleViewport);
  globalThis.visualViewport?.addEventListener('scroll', pinSplashToVisibleViewport);
  globalThis.addEventListener('resize', pinSplashToVisibleViewport);
  const dismissSplash = () => {
    splash?.classList.add('app-splash--done');
    globalThis.visualViewport?.removeEventListener('resize', pinSplashToVisibleViewport);
    globalThis.visualViewport?.removeEventListener('scroll', pinSplashToVisibleViewport);
    globalThis.removeEventListener('resize', pinSplashToVisibleViewport);
  };
  setTimeout(dismissSplash, 2500);
  try {
    await db.open();
    await loadLocalState();
    await enterSingleInstalledRegion();
    await migrateLegacyJournalAudio();
    const requestedCity = new URLSearchParams(globalThis.location?.search || '').get('city');
    if (requestedCity && CITIES[requestedCity] && navigator.onLine !== false) {
      state.activeCity = requestedCity;
      state.settings.activeCity = requestedCity;
      await db.put('settings', state.settings);
    }
    await applyOfflineBootConditions();
    await loadAllCityData();
  } catch (error) {
    console.error(error);
    toast('Local storage or places data could not open in this browser.');
    return;
  }

  initMap();
  await activateInstalledRegionRuntime();
  await initCountyAdditions();
  await initMapPaint();
  await initPersonalPlaces();
  await initLayerSystem();
  initFieldGuideFilters();

  try {
    initEvents();
  } catch (error) {
    console.error('initEvents failed:', error);
  }

  await refreshCityMap(false);
  await recoverWalkDraft();
  applyStaticAppearance();
  await renderArchive();
  if (!state.settings.mapToolsHintSeenV2) {
    const hint = document.getElementById('mapIntroHint');
    state.settings.mapToolsHintSeenV2 = true;
    await db.put('settings', state.settings);
    hint?.classList.remove('hidden');
    setTimeout(() => hint?.classList.add('dissolving'), 8800);
    setTimeout(() => hint?.classList.add('hidden'), 10000);
  }

  if (splash) requestAnimationFrame(dismissSplash);

  try {
    // No auth/onboarding sheet at launch. Only Go online starts a ceremony.
    await initOnlinePane();
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
    const cityId = moment.city || state.activeCity || DEFAULT_CITY_ID;
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
  if (!CITIES[state.settings.activeCity]?.dataFile) {
    state.settings.activeCity = state.settings.favoriteRegionIds?.find((id) => CITIES[id]?.dataFile) || DEFAULT_CITY_ID;
  }
  state.activeCity = state.settings.activeCity;
  state.lastPosition = validSavedPosition(state.settings.lastPosition) ? { ...state.settings.lastPosition } : null;
  state.walks = savedWalks;
  state.knownTrackPoints = savedWalks.flatMap((walk) => (walk.points || []).filter((_, index) => index % 5 === 0));
  await restoreLocalPoiClosures();
  await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
}

function validSavedPosition(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
}

export function cityIdForInstalledRegion(regionId) {
  const normalized = String(regionId || '');
  return Object.entries(CITIES).find(([cityId, pack]) => cityId === normalized
    || pack.packId === normalized
    || JSON.stringify(pack).includes(`./regions/${normalized}/`))?.[0] || null;
}

export async function enterSingleInstalledRegion() {
  const installed = (await db.all('regions')).filter((entry) => entry?.status === 'installed' && entry.id);
  if (installed.length !== 1) return null;
  const cityId = cityIdForInstalledRegion(installed[0].id);
  if (!cityId) return null;
  state.activeCity = cityId;
  state.settings.activeCity = cityId;
  state.settings.onboardingCompleted = true;
  state.autoEnteredInstalledPack = true;
  await db.put('settings', state.settings);
  return { ...installed[0], cityId };
}
