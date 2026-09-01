// Keep the whole module graph with the shell. Caching only app.js leaves an
// offline (or briefly disconnected) reload with a blank app when any imported
// module was not already in the runtime cache.
const APP_CACHE = 'walk-wildlife-shell-v68'; // bump when shell assets change
const TILE_CACHE = 'walk-wildlife-osm-viewed-tiles-v1';
const LIBRARY_CACHE = 'walk-wildlife-library-v2';
const COMPANION_CACHE = 'walk-wildlife-companion-media-v2';
const libraryPath = new URL('./vendor/', self.registration.scope).pathname;
const shell = [
  './', './index.html', './watch.html', './styles.css', './watch.css', './legal.css', './privacy.html', './terms.html', './app.js', './manifest.webmanifest', './watch.webmanifest', './supabase-config.js',
  './assets/pwa-icon-192.png', './assets/pwa-icon-512.png', './assets/pwa-maskable-512.png', './assets/apple-touch-icon.png', './assets/splash-screen.jpeg', './assets/splash-1170x2532.png', './assets/splash-1290x2796.png', './assets/splash-2048x2732.png',
  './js/archive.js', './js/backup.js', './js/city.js', './js/civic.js', './js/constants.js', './js/discovery.js', './js/discovery-taxonomy.js',
  './js/entitlements.js', './js/cloud-journal.js', './js/events.js', './js/explore.js', './js/field-edition-loader.js', './js/field-guide.js', './js/geo.js', './js/geofence.js',
  './js/federal-boundaries.js', './js/federal-region-loader.js', './js/federal-region-progress.js', './js/poi-visit-tracking.js', './js/loader.js', './js/map.js', './js/observation.js', './js/online.js', './js/planner.js', './js/poi.js', './js/profile.js',
  './js/neighborhoods.js', './js/spatial-index.js', './js/spatial-index-providers.js', './js/spatial-overlay.js', './js/spatial-package-loader.js', './js/spatial-closure-reporting.js', './js/text-to-walk.js',
  './js/quiet-places.js', './js/region-api.js', './js/region-installer.js', './js/region-manager.js', './js/region-package.js',
  './js/osm-regions.js',
  './js/region-ui.js', './js/routes.js', './js/routing.js', './js/runtime-router.mjs', './js/offline-router-worker.js', './js/seasonal-awareness.js', './js/state.js', './js/storage.js',
  './js/ui.js', './js/utils.js', './js/walk.js', './js/walk-artifact.js', './js/walk-context.js', './js/companion.js', './js/revisit.js', './js/journal-transfer.js', './js/watch-session.js', './js/watch-app.js', './js/device-entry.js', './js/observation-model.js', './js/weather.js', './js/journal-pane.js', './js/icon-loader.js', './js/layer-system.js', './js/personal-places.js',
  './icons/mic.svg', './icons/trash-2.svg', './icons/water-fountain.svg', './icons/bench.svg', './icons/parking.svg', './icons/bike.svg', './icons/building.svg', './icons/utensils.svg',
  './data/anchorage-poi.json', './data/baltimore-poi.json', './data/boise-meridian-idaho-poi.json', './data/columbus-poi.json', './data/corpus-christi-poi.json',
  './data/dc-poi.json', './data/detroit-poi.json', './data/fort-worth-poi.json', './data/keystone-colorado-poi.json', './data/los-angeles-poi.json',
  './data/newyork-poi.json', './data/norfolk-poi.json', './data/pgcounty-poi.json', './data/philadelphia-poi.json', './data/pittsburgh-poi.json',
  './data/richmond-poi.json', './data/seattle-poi.json', './data/sedona-arizona-poi.json', './data/tempe-poi.json', './data/vienna-poi.json', './data/vienna-trails.json',
  './data/pedestrian-runtime/nyc_pedestrian_network_estimates/runtime/runtime-graph.json',
  './data/pedestrian-runtime/dvrpc_pedestrian_network_philadelphia_camden/runtime/runtime-graph.json',
  ...['asheville', 'boston', 'boulder', 'chicago', 'denver', 'new-orleans', 'portland', 'portland-maine', 'san-francisco', 'santa-fe', 'wolf-trap-va'].map((region) => `./regions/${region}/pois.json`),
  ...['alexandria-va', 'arlington-va', 'baltimore', 'boise-meridian-idaho', 'boston', 'boulder', 'chicago', 'columbus', 'corpus-christi', 'denver', 'detroit', 'fairfax-county-va', 'falls-church-va', 'fort-worth', 'keystone-colorado', 'los-angeles', 'loudoun-county-va', 'new-orleans', 'norfolk', 'nyc', 'philadelphia', 'pittsburgh', 'portland', 'portland-maine', 'prince-georges-county-md', 'richmond', 'san-francisco', 'santa-fe', 'seattle', 'sedona-arizona', 'tempe', 'washington-dc', 'wolf-trap-va'].flatMap((region) => [
    `./regions/${region}/osm/pois.json`, `./regions/${region}/osm/manifest.json`, `./regions/${region}/osm/validation.json`,
    `./regions/${region}/osm/spatial-index-delta.json`, `./regions/${region}/osm/attribution.json`
  ]),
  ...['alexandria-va', 'arlington-va', 'baltimore', 'boise-meridian-idaho', 'boston', 'boulder', 'chicago', 'columbus', 'corpus-christi', 'denver', 'detroit', 'fairfax-county-va', 'falls-church-va', 'fort-worth', 'keystone-colorado', 'los-angeles', 'loudoun-county-va', 'new-orleans', 'pittsburgh', 'portland', 'portland-maine', 'prince-georges-county-md', 'san-francisco', 'santa-fe', 'seattle', 'sedona-arizona', 'tempe', 'washington-dc'].map((region) => `./regions/${region}/osm/merged-pois.json`),
  './regions/washington-dc/geography/neighborhoods.geojson', './regions/washington-dc/geography/source.json',
  './regions/fairfax-county-va/pois.json', './regions/fairfax-county-va/journeys.json', './regions/fairfax-county-va/edges.json',
  './regions/fairfax-county-va/discover.json', './regions/fairfax-county-va/learn.json', './regions/fairfax-county-va/capabilities.json', './regions/fairfax-county-va/civic/index.json',
  './assets/fox-idle.gif', './assets/fox-walk.gif', './assets/cloud-idle.gif', './assets/cloud-walk.gif', './assets/compass.gif',
  './regions/washington-dc/spatial/spatial-index-manifest.json', './regions/washington-dc/spatial/pois.flatbush', './regions/washington-dc/spatial/pois.ids.json',
  './regions/washington-dc/spatial/boundaries.flatbush', './regions/washington-dc/spatial/boundaries.ids.json'
];
const libraryAssets = [
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet-markercluster/MarkerCluster.css',
  './vendor/leaflet-markercluster/MarkerCluster.Default.css',
  './vendor/leaflet-markercluster/leaflet.markercluster.js',
  './vendor/maplibre-gl.css',
  './vendor/maplibre-gl.js',
  './vendor/pmtiles.js',
  './vendor/flatbush/flatbush.js',
  './vendor/flatbush/flatqueue.js',
  './vendor/rbush/rbush.js',
  './vendor/rbush/quickselect.js'
];


self.addEventListener('install', (event) => event.waitUntil(Promise.all([
  caches.open(APP_CACHE).then((cache) => cache.addAll(shell)),
  caches.open(LIBRARY_CACHE).then(async (cache) => {
    await Promise.all(libraryAssets.map(async (asset) => {
      try {
        const response = await fetch(asset, { mode: 'no-cors' });
        await cache.put(asset, response);
      } catch (_) { /* The app can still install if a CDN is briefly unavailable. */ }
    }));
  })
]).then(() => self.skipWaiting())));

self.addEventListener('activate', (event) => event.waitUntil(
  Promise.all([
    // Clean up any old versioned caches so they don't linger and don't get matched by accident.
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => (
          (key.startsWith('walk-wildlife-shell-') && key !== APP_CACHE)
          || (key.startsWith('walk-wildlife-companion-media-') && key !== COMPANION_CACHE)
        ))
        .map((key) => caches.delete(key))
    )),
    self.clients.claim()
  ])
));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isMapTile = /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname);

  if (isMapTile) {
    event.respondWith(caches.open(TILE_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }

  if (url.origin === self.location.origin && /\/assets\/[^/]+\.gif$/i.test(url.pathname)) {
    // GIFs enter this persistent cache only after the selected companion or a
    // real contextual state requests them. Nothing here preloads rare media.
    event.respondWith(caches.open(COMPANION_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith(libraryPath)) {
    event.respondWith(caches.open(LIBRARY_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    // Network-first for the app shell: always try to get the latest deploy.
    // Only fall back to cache when the network is unavailable (offline support).
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) { payload = { body: event.data?.text() || '' }; }
  const title = payload.title || 'Discover Walks';
  const options = {
    body: payload.body || 'There is a new update connected to your walking journal.',
    icon: './assets/pwa-icon-192.png',
    badge: './assets/pwa-icon-192.png',
    tag: payload.tag || 'walk-journal-update',
    renotify: false,
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;
  const targetUrl = requestedUrl.startsWith(self.registration.scope) ? requestedUrl : self.registration.scope;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.focus(); existing.navigate(targetUrl); return; }
    await clients.openWindow(targetUrl);
  }));
});
