// All capture and workspace modules must share the connection opened here.
import db from './storage.js';
import { state } from './state.js';
import { DEFAULT_SETTINGS, CITIES, DEFAULT_CITY_ID } from './constants.js';
import { normalizeProfile, sitesForProfile } from './utils.js';
import { toast } from './ui.js';
import { initMap } from './map.js?v=20261105-region-control-1';
import { applyStaticAppearance } from './ui.js';
import { loadAllCityData, refreshCityMap } from './city.js?v=20261103-header-repair-2';
import { renderWeatherBrief } from './weather.js?v=20261105-daylight-refresh-5';
import { renderArchive } from './archive.js';
import { normalizedEntitlements } from './entitlements.js';
import { restoreLocalPoiClosures } from './spatial-closure-reporting.js';
import { initFieldGuideFilters } from './field-guide.js?v=140-live-learn-by-me';
import { initPersonalPlaces } from './personal-places.js';
import { initLayerSystem } from './layer-system.js';
import { initMapPaint } from './map-paint.js?v=20261102-crosshair-pin-placement-1';
import { activateInstalledRegionRuntime } from './installed-region-runtime.js';
import { initCountyAdditions } from './county-additions.js';
import { applyOfflineBootConditions } from './offline-view.js';
import { migrateLegacyJournalAudio } from './journal-capture.js';
import { initOnlinePane } from './online-pane.js';
import { startCoachMarks } from './coach.js';
import { initNationalOsmLayers } from './national-osm-layers.js';
import { initPwaUpdates } from './pwa-update.js';
import { initPrimaryShell } from './primary-shell.js?v=20261104-region-after-draw-2';
import { initRadialMenu } from './radial-menu.js?v=20261103-radial-start-walk-1';
import { initStories } from './stories.js';
import { initRadio } from './radio.js?v=20261009-radio-controls-2';
import { recoverWalkDraft, discardWalk } from './walk.js';
import { initBiodiversity } from './biodiversity.js?v=20261103-live-biodiversity-clusters-2';
import { initRegionalNavigation } from './regional-navigation.js?v=20261104-subregion-switch-1';
import { initStorageDiagnostics } from './storage-diagnostics.js';
import { initStorageHealth } from './storage-health.js';
import { loadWorkspaceState, initWorkspaceRuntime, seedWorkspaceDemo } from './workspace.js?v=20261109-journal-filters-1';
import { normalizeSavedRoute } from './saved-routes.js';
import { initMapSettings } from './map-settings.js';
import { initRegionalRoutingPackagesUI } from './regional-routing-packages-ui.js?v=20261104-valhalla-packages-ui-1';

export async function init() {
  const telemetry = (stage, details = {}) => globalThis.__MOTHERBIRD_STARTUP_MARK__?.(stage, details);
  performance.mark?.('motherbird:init:start');
  initConnectivitySignals();
  const splashStatus = document.getElementById('appSplashStatus');
  const setSplashStatus = (message) => { if (splashStatus) splashStatus.textContent = message; };
  setSplashStatus('Getting your pencils sharpened…');
  if (!document.querySelector('link[href*="splash-fix.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './splash-fix.css?v=73';
    document.head.appendChild(link);
  }
  const splash = document.getElementById('appSplash');
  const storageStatusMessages = {
    checking: 'Device journal is loading',
    durable: 'Changes are safely saved on this device',
    temporary: 'This session is temporary until device storage recovers',
    recovering: 'Another tab is finishing a database update',
    failed: 'Device journal storage needs attention',
    'quota-exceeded': 'Device storage quota is full'
  };
  const stopStorageStatus = db.onPersistenceState?.((event) => {
    const message = storageStatusMessages[event.state];
    if (message) document.body.dataset.storageState = event.state;
    if (event.state === 'quota-exceeded') toast(message);
    else if (event.state === 'failed') toast(message);
  });
  const pinSplashToVisibleViewport = () => {
    if (!splash || splash.classList.contains('app-splash--done')) return;
    splash.style.position = 'fixed';
    splash.style.top = '0';
    splash.style.left = '0';
    splash.style.right = '0';
    splash.style.bottom = '0';
    splash.style.width = '100%';
    splash.style.height = '100%';
    splash.style.height = '-webkit-fill-available';
    splash.style.minHeight = '100dvh';
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
  setTimeout(dismissSplash, 1200);
  // Keep the visible app chrome usable even if optional data packages fail to
  // load. Geo Cypher is initialized lazily here so its record button is also
  // available on browsers that finish booting slowly.
  const removePrimaryControlFallbacks = initPrimaryControls();
  initStorageDiagnostics();
  initStorageHealth();
  initRegionalRoutingPackagesUI();
  const deferRegionalDataForBoot = true;
  try {
    setSplashStatus('Opening your journal…');
    // IndexedDB can hard-block startup on a stale or suspended tab. Keep the
    // map usable while persistence is repaired; db's memory fallback still
    // supports the current session.
    await db.open({ timeoutMs: 1500, beforeRiskyMigration: async (details) => {
      if (!confirm('Walk & Wildlife needs a local data upgrade. Download a private backup first? Cancel skips the backup and continues.')) return;
      const backup = await db.createPreMigrationBackup(details);
      const url = URL.createObjectURL(backup);
      const link = document.createElement('a'); link.href = url; link.download = `walk-wildlife-before-database-v${details.toVersion}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } });
    const durableStorage = Boolean(db.isDurable?.());
    telemetry('persistence', { durable: durableStorage });
    if (!durableStorage) {
      toast('Device journal database is busy in another tab; this session is usable and will retry automatically.');
      setTimeout(async () => {
        const recovered = await db.open({ timeoutMs: 1500 }).catch(() => false);
        const durable = Boolean(db.isDurable?.()) && recovered !== false;
        telemetry('persistence retry', { durable });
        if (durable) toast('Device journal database is available again; this session is saved durably.');
      }, 5000);
    }
    await loadLocalState();
    await loadWorkspaceState();
    await seedWorkspaceDemo();
    initWorkspaceRuntime();
    await enterSingleInstalledRegion();
    void migrateLegacyJournalAudio().catch((error) => console.warn('Journal audio migration unavailable:', error.message));
    const params = new URLSearchParams(globalThis.location?.search || '');
    const requestedCity = params.get('city') || (params.get('routecheck') === '1' ? 'alexandria' : null);
    if (requestedCity && CITIES[requestedCity] && navigator.onLine !== false) {
      state.activeCity = requestedCity;
      state.settings.activeCity = requestedCity;
      await db.put('settings', state.settings);
    }
    await applyOfflineBootConditions();
    setSplashStatus('Unfolding the map…');
    // Keep the shell responsive even when a regional JSON package is too
    // large or malformed for this browser to parse during startup.
    if (!deferRegionalDataForBoot) await loadAllCityData();
    performance.measure?.('motherbird:init:city-data', 'motherbird:init:start');
  } catch (error) {
    console.error(error);
    const message = /places data could not be loaded|Regional data request failed/i.test(error?.message || '')
      ? 'The regional map data could not load. Check your connection and reload.'
      : (storageStatusMessages[db.persistenceState?.()] || 'Device journal storage needs attention');
    toast(message);
    stopStorageStatus?.();
    return;
  }

  // National layer settings are optional boot data. Do not hold the core map,
  // walk bar, or radio behind a slow/corrupt layer-settings read.
  void initNationalOsmLayers().catch((error) => console.warn('National layer settings unavailable:', error.message));
  initMap();
  // Render the header weather/time independently of optional city enrichment.
  // A slow or unavailable regional package must not leave the header blank.
  void renderWeatherBrief().catch(() => {});
  telemetry('map');
  setSplashStatus('Initializing the map…');
  // Draw and layer controls are part of the visible map surface. Bind them
  // before startup-ready so fast devices cannot expose a clickable shell
  // whose core controls are still waiting behind optional enrichment.
  await initMapPaint().catch((error) => console.warn('Map paint unavailable:', error.message));
  await initLayerSystem().catch((error) => console.warn('Layer system unavailable:', error.message));
  await import('./events.js?v=local-mip-duckdb-20261104-1')
    .then(({ initEvents }) => initEvents())
    .catch((error) => console.warn('Core controls unavailable:', error.message));
  const refreshMapLayout = () => state.map?.invalidateSize({ pan: false });
  requestAnimationFrame(refreshMapLayout);
  // The walk planner is core map functionality. Bind it before optional
  // stories, radio, and companion layers can abort startup on bad local data.
  requestAnimationFrame(() => { refreshMapLayout(); dismissSplash(); });
  window.setTimeout(refreshMapLayout, 400);
  window.setTimeout(refreshMapLayout, 1200);
  window.addEventListener('pageshow', refreshMapLayout, { once: true });
  // Bind the already-visible radial control before optional boot work can
  // leave a slow browser with an inert Start walk button.
  initRadialMenu();
  initRegionalNavigation();
  telemetry('controls');
  initPrimaryShell();
  initMapSettings();

  // The core map is ready now. Optional local/network features must not hold
  // the whole app hostage behind a slow manifest, migration, or region fetch.
  if (!deferRegionalDataForBoot) await refreshCityMap(false);
  const optionalBoot = (label, task) => Promise.resolve().then(task).catch((error) => {
    console.warn(`[motherbird:optional-boot] ${label} unavailable:`, error?.message || error);
    return null;
  });
  void optionalBoot('regional map data', async () => {
    const { loadCityData, refreshCityMap } = await import('./city.js');
    await loadCityData(state.activeCity);
    await refreshCityMap(false);
  });
  void (async () => {
    initRadialMenu();
    void optionalBoot('stories', initStories);
    void optionalBoot('field guide filters', initFieldGuideFilters);
    void optionalBoot('biodiversity', initBiodiversity);
    await optionalBoot('radio', initRadio);
    removePrimaryControlFallbacks();
    await optionalBoot('installed-region', activateInstalledRegionRuntime);
    await optionalBoot('county additions', initCountyAdditions);
    await optionalBoot('personal places', initPersonalPlaces);
  })();
  performance.measure?.('motherbird:init:ready', 'motherbird:init:start');
  telemetry('startup-ready', { city: state.activeCity, durableStorage: Boolean(db.isDurable?.()) });
  console.info?.('[motherbird:perf] startup-ready', {
    duration: Math.round(performance.getEntriesByName('motherbird:init:ready').at(-1)?.duration || 0),
    city: state.activeCity,
    pois: state.cityPois[state.activeCity]?.length || 0
  });
  // Refresh returns to a neutral map state. Any draft remains stored for an
  // explicit recovery flow; never restart live tracking automatically.
  applyStaticAppearance();
  void renderArchive().catch((error) => console.warn('Archive render unavailable:', error.message));
  void offerWalkDraftRecovery().catch((error) => console.warn('Walk recovery unavailable:', error.message));
  void Promise.resolve().then(() => startCoachMarks()).catch((error) => console.warn('Coach marks unavailable:', error.message));

  if (splash) requestAnimationFrame(dismissSplash);

  // No auth/onboarding sheet at launch. Only Go online starts a ceremony.
  void optionalBoot('online pane', initOnlinePane);
  void optionalBoot('app updates', initPwaUpdates);

  // Opt-in live routing verification: exercise the installed planner and
  // renderer after the full map/runtime boot has completed. This is query-
  // gated and does not affect normal visitors.
  if (new URLSearchParams(globalThis.location?.search || '').get('routecheck') === '1') {
    window.MOTHER_BIRD_WALKING_CELLS = {
      manifestUrl: './data/national-routing/osm-us-2026-10-04/cells.json?v=20261005-national-92-1'
    };
    state.plannerStart = { lat: 38.8338858, lng: -77.0482543 };
    state.plannerEnd = { lat: 38.8348141, lng: -77.0508987 };
    const pointToPoint = document.querySelector('input[name="routeMode"][value="point-to-point"]');
    if (pointToPoint) pointToPoint.checked = true;
    const { generateTimeBasedPlan } = await import('./planner.js?v=20261011-auto-candidate-2');
    await generateTimeBasedPlan({ title: 'Published routing-cell verification' });
  }

}

function initConnectivitySignals() {
  const update = (state, announce = true) => {
    document.body.dataset.networkState = state;
    if (announce && state === 'offline') toast('Offline mode: saved walks and installed places remain available.');
    if (announce && state === 'online') toast('Connection restored. Online features can refresh when opened.');
  };
  update(navigator.onLine === false ? 'offline' : 'online', false);
  window.addEventListener('offline', () => update('offline'));
  window.addEventListener('online', () => update('online'));
}

async function offerWalkDraftRecovery() {
  const draft = await db.get('walk_drafts', 'active-walk');
  if (!draft?.walk || !['recording', 'stopped'].includes(draft.walk.recordingStatus)) return;
  const sheet = document.getElementById('walkRecoverySheet');
  if (!sheet) return;
  sheet.classList.remove('hidden');
  document.getElementById('resumePreviousWalk')?.addEventListener('click', async () => {
    sheet.classList.add('hidden'); await recoverWalkDraft();
  }, { once: true });
  document.getElementById('endPreviousWalk')?.addEventListener('click', async () => {
    sheet.classList.add('hidden'); const recovered = await recoverWalkDraft();
    if (recovered) await discardWalk();
  }, { once: true });
}

function initPrimaryControls() {
  const controls = [
    [document.querySelector('[data-open-field-guide]'), () => import('./ui.js').then(({ openBackpack }) => openBackpack())],
    [document.getElementById('journalButton'), () => import('./ui.js').then(({ openJournal }) => openJournal())],
  ];
  controls.forEach(([button, handler]) => button?.addEventListener('click', handler));
  return () => controls.forEach(([button, handler]) => button?.removeEventListener('click', handler));
}

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
  const [savedProfile, savedSettings, savedWalks, savedRoutes, savedPlans] = await Promise.all([db.get('profile', 'local-user'), db.get('settings', 'app-settings'), db.all('walks'), db.all('saved_routes'), db.all('walk_plans')]);
  state.profile = savedProfile ? normalizeProfile(savedProfile) : await createMigratedProfile();
  state.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  if (!Array.isArray(state.settings.geofenceCategories) || !state.settings.geofenceCategories.length) state.settings.geofenceCategories = ['news', 'recreation', 'cuisine'];
  state.settings.entitlements = normalizedEntitlements(state.settings.entitlements);
  if (!CITIES[state.settings.activeCity]?.dataFile) {
    state.settings.activeCity = state.settings.favoriteRegionIds?.find((id) => CITIES[id]?.dataFile) || DEFAULT_CITY_ID;
  }
  state.activeCity = state.settings.activeCity;
  state.lastPosition = validSavedPosition(state.settings.lastPosition) ? { ...state.settings.lastPosition } : null;
  state.walks = savedWalks;
  state.savedRoutes = savedRoutes.map((route) => {
    try { return normalizeSavedRoute(route, route.updatedAt || route.createdAt || new Date().toISOString()); }
    catch { return route; }
  });
  state.walkPlan = savedPlans.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;
  if (state.walkPlan) state.plannedRoute = { ...state.walkPlan.route, id: state.walkPlan.id, stops: state.walkPlan.encounters || [], reason: state.walkPlan.rationale?.summary || '' };
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
