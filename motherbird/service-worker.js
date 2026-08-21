// Keep the whole module graph with the shell. Caching only app.js leaves an
// offline (or briefly disconnected) reload with a blank app when any imported
// module was not already in the runtime cache.
const APP_CACHE = 'walk-wildlife-shell-v48'; // bump when shell assets change
const TILE_CACHE = 'walk-wildlife-osm-viewed-tiles-v1';
const LIBRARY_CACHE = 'walk-wildlife-library-v2';
const libraryPath = new URL('./vendor/', self.registration.scope).pathname;
const shell = [
  './', './index.html', './styles.css', './legal.css', './privacy.html', './terms.html', './app.js', './manifest.webmanifest', './supabase-config.js', './assets/walk-companion.gif',
  './js/archive.js', './js/backup.js', './js/city.js', './js/civic.js', './js/constants.js', './js/discovery.js', './js/discovery-taxonomy.js',
  './js/entitlements.js', './js/events.js', './js/explore.js', './js/field-edition-loader.js', './js/field-guide.js', './js/geo.js', './js/geofence.js',
  './js/federal-boundaries.js', './js/federal-region-loader.js', './js/loader.js', './js/map.js', './js/observation.js', './js/online.js', './js/planner.js', './js/poi.js', './js/profile.js',
  './js/neighborhoods.js', './js/spatial-index.js', './js/spatial-index-providers.js', './js/spatial-overlay.js', './js/spatial-package-loader.js', './js/spatial-closure-reporting.js', './js/text-to-walk.js',
  './js/quiet-places.js', './js/region-api.js', './js/region-installer.js', './js/region-manager.js', './js/region-package.js',
  './js/region-ui.js', './js/routes.js', './js/routing.js', './js/seasonal-awareness.js', './js/state.js', './js/storage.js',
  './js/ui.js', './js/utils.js', './js/walk.js', './js/weather.js',
  './data/boise-meridian-idaho-poi.json', './data/dc-poi.json', './data/keystone-colorado-poi.json', './data/newyork-poi.json', './data/norfolk-poi.json',
  './data/pgcounty-poi.json', './data/philadelphia-poi.json', './data/richmond-poi.json', './data/sedona-arizona-poi.json', './data/vienna-poi.json', './data/vienna-trails.json',
  './regions/washington-dc/geography/neighborhoods.geojson', './regions/washington-dc/geography/source.json',
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
        .filter((key) => key.startsWith('walk-wildlife-shell-') && key !== APP_CACHE)
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
