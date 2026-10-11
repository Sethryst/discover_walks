// Keep the whole module graph with the shell. Caching only app.js leaves an
// offline (or briefly disconnected) reload with a blank app when any imported
// module was not already in the runtime cache.
const APP_CACHE = 'walk-wildlife-shell-v403'; // Keep large regional enrichment out of startup
const TILE_CACHE = 'walk-wildlife-map-tiles-v2';
const LIBRARY_CACHE = 'walk-wildlife-library-v2';
const COMPANION_CACHE = 'walk-wildlife-companion-media-v2';
const CACHE_ENTRY_BUDGETS = Object.freeze({ [TILE_CACHE]: 250, [LIBRARY_CACHE]: 120, [COMPANION_CACHE]: 24 });
async function trimCache(cache, name) { const budget = CACHE_ENTRY_BUDGETS[name]; if (!budget) return; const keys = await cache.keys(); for (const key of keys.slice(0, Math.max(0, keys.length - budget))) await cache.delete(key); }
const libraryPath = new URL('./vendor/', self.registration.scope).pathname;
const shell = [
  './css/radio-theme.css',
  ...['anchor', 'book-open', 'bookmark', 'coffee', 'download', 'droplet', 'eye', 'globe', 'newspaper', 'star', 'tree', 'walk', 'navigation', 'search', 'skip-back', 'skip-forward'].map((icon) => `./icons/${icon}.svg`),
  './js/online-pane.js', './js/qr-share.js', './js/open-payload.js', './js/sealed-data.js', './js/historical-media.js', './js/offline-view.js', './js/friend-walk.js', './js/place-details.js', './js/regional-data-worker.js',
  './js/offline-map-style.js', './js/installed-tiles.js', './js/story-audio.js',
  './data/biodiversity-regions.json', './data/biodiversity-nova-source.json', './data/biodiversity-import-report.json', './js/biodiversity.js', './data-contracts/biodiversity-record.schema.json', './regions/alexandria-va/biodiversity/manifest.json', './regions/alexandria-va/biodiversity/records.json', './regions/arlington-va/biodiversity/manifest.json', './regions/arlington-va/biodiversity/records.json', './regions/fairfax-county-va/biodiversity/manifest.json', './regions/fairfax-county-va/biodiversity/records.json', './regions/falls-church-va/biodiversity/manifest.json', './regions/falls-church-va/biodiversity/records.json', './regions/loudoun-county-va/biodiversity/manifest.json', './regions/loudoun-county-va/biodiversity/records.json', './regions/vienna/biodiversity/manifest.json', './regions/vienna/biodiversity/records.json',
  './js/heartbeat.js', './js/onboarding.js', './js/reflection.js', './js/region-favorites.js', './js/spatial-sync-outbox.js', './js/spatial-sync-policy.js', './js/pwa-update.js', './js/radial-menu.js', './js/location-simulator.js',
  './data/dc-official-trails.js', './data/dc-stories.js', './icons/plus.svg',
  './', './index.html', './research-lab.html', './research-lab.html?v=2', './watch.html', './styles.css', './radio.css', './shell.css', './splash-fix.css', './watch.css', './legal.css', './privacy.html', './terms.html', './app.js', './manifest.webmanifest', './watch.webmanifest', './supabase-config.js', './research/national-discovery/national-candidate-package.json', './research/national-discovery/focused-source-validation-2026-10-02.json', './research/national-discovery/focused-source-acceptance-2026-10-02.json', './research/national-discovery/honolulu-focused-event-package.json', './research/national-discovery/austin-focused-event-package.json', './research/national-discovery/albuquerque-focused-event-package.json', './research/national-discovery/cleveland-focused-event-package.json',
  './assets/pwa-icon-192.png', './assets/pwa-icon-512.png', './assets/pwa-maskable-512.png', './assets/apple-touch-icon.png', './assets/splash-screen.jpeg', './assets/splash-1170x2532.png', './assets/splash-1290x2796.png', './assets/splash-2048x2732.png',
  './js/archive.js', './js/backup.js', './js/city.js', './js/civic.js', './js/civic-news.js', './js/constants.js', './js/discovery.js', './js/discovery-taxonomy.js',
  './js/entitlements.js', './js/cloud-journal.js', './js/events.js', './js/explore.js', './js/field-edition-loader.js', './js/field-guide.js', './js/messenger-bird.js', './js/maps-folders.js', './js/learn-change.js', './js/learn-explore.js', './js/learn-folders.js', './js/learn-history.js', './js/news-map.js', './js/search.js', './js/geo.js', './js/geofence.js', './js/primary-shell.js', './js/radio.js', './data/radio/labri.json',
  './js/federal-boundaries.js', './js/federal-region-loader.js', './js/federal-region-progress.js', './js/poi-visit-tracking.js', './js/loader.js', './js/coach.js', './js/map.js', './js/observation.js', './js/online.js', './js/planner.js', './js/poi.js', './js/profile.js',
  './js/neighborhoods.js', './js/spatial-index.js', './js/spatial-index-providers.js', './js/spatial-overlay.js', './js/spatial-package-loader.js', './js/spatial-closure-reporting.js', './js/text-to-walk.js',
  './js/quiet-places.js', './js/source-adapters.js', './js/acquisition-package-runtime.js', './js/outbox-runtime.js', './js/region-api.js', './js/region-installer.js', './js/region-manager.js', './js/region-package.js', './js/osm-release.js',
  './js/osm-regions.js', './js/national-poi-map.js', './js/national-osm-layers.js', './js/offline-routing-package.mjs', './js/opfs-range-source.js', './js/walking-cell-registry.js', './js/walking-cell-cache.js', './js/walking-cell-runtime.js', './js/personal-edge-scores.js', './js/geo-cypher.js', './js/room-runtime.js', './js/room-renderers.js', './js/spatial-query.js', './js/spatial-model.js',
  './js/region-ui.js', './js/routes.js', './js/stories.js', './js/routing.js', './js/route-place-labels.js', './js/routing-feedback.js', './js/runtime-router.mjs', './js/offline-router-worker.js', './js/seasonal-awareness.js', './js/state.js', './js/storage.js', './js/storage-diagnostics.js', './js/saved-routes.js', './js/workspace.js',
  './js/ui.js', './js/utils.js', './js/walk.js', './js/walk-artifact.js', './js/ambient-mip.js', './js/mip-features.js', './js/walk-context.js', './js/walk-state.js', './js/companion.js', './js/revisit.js', './js/journal-transfer.js', './js/journal-capture.js', './js/map-paint.js', './js/county-additions.js', './js/installed-region-runtime.js', './js/watch-session.js', './js/watch-app.js', './js/device-entry.js', './js/observation-model.js', './js/weather.js', './js/journal-pane.js', './js/quote-context.js', './js/icon-loader.js', './js/poi-icons.js', './js/poi-filter-rules.js', './js/layer-system.js', './js/personal-places.js', './js/planner-selection.js',
  './icons/mic.svg', './icons/pencil.svg', './icons/camera.svg', './icons/target.svg', './icons/share-2.svg', './icons/map-pin.svg', './icons/trash-2.svg', './icons/water-fountain.svg', './icons/bench.svg', './icons/parking.svg', './icons/bike.svg', './icons/building.svg', './icons/utensils.svg', './icons/home.svg', './icons/activity.svg', './icons/route.svg', './icons/alert-circle.svg', './icons/layers.svg',
  './data/anchorage-poi.json', './data/baltimore-poi.json', './data/boise-meridian-idaho-poi.json', './data/columbus-poi.json', './data/corpus-christi-poi.json',
  './data/dc-poi.json', './data/detroit-poi.json', './data/fort-worth-poi.json', './data/keystone-colorado-poi.json', './data/los-angeles-poi.json',
  './data/newyork-poi.json', './data/norfolk-poi.json', './data/pgcounty-poi.json', './data/philadelphia-poi.json', './data/pittsburgh-poi.json',
  './data/richmond-poi.json', './data/seattle-poi.json', './data/sedona-arizona-poi.json', './data/tempe-poi.json', './data/vienna-poi.json', './data/vienna-trails.json',
  './data/learn/index.json', './data/learn/discover/watersheds.json', './data/learn/history/pack-splits.json', './data/learn/history/battlefields.json',
  // Routing graphs are fetched only after a user asks for routing.
  ...['asheville', 'boston', 'boulder', 'chicago', 'cleveland', 'denver', 'new-orleans', 'portland', 'portland-maine', 'san-francisco', 'santa-fe', 'wolf-trap-va'].map((region) => `./regions/${region}/pois.json`),
  ...['alexandria-va', 'arlington-va', 'baltimore', 'boise-meridian-idaho', 'boston', 'boulder', 'chicago', 'columbus', 'corpus-christi', 'denver', 'detroit', 'eugene', 'fairfax-county-va', 'falls-church-va', 'fort-worth', 'keystone-colorado', 'las-vegas', 'loudoun-county-va', 'madison', 'milwaukee', 'new-orleans', 'norfolk', 'nyc', 'philadelphia', 'pittsburgh', 'portland', 'portland-maine', 'prince-georges-county-md', 'providence', 'richmond', 'san-francisco', 'santa-fe', 'seattle', 'sedona-arizona', 'tempe', 'washington-dc'].flatMap((region) => [
    `./regions/${region}/osm/pois.json`, `./regions/${region}/osm/manifest.json`, `./regions/${region}/osm/validation.json`,
    `./regions/${region}/osm/spatial-index-delta.json`, `./regions/${region}/osm/attribution.json`
  ]),
  ...['alexandria-va', 'arlington-va', 'baltimore', 'boise-meridian-idaho', 'boston', 'boulder', 'chicago', 'columbus', 'corpus-christi', 'denver', 'detroit', 'eugene', 'fairfax-county-va', 'falls-church-va', 'fort-worth', 'keystone-colorado', 'las-vegas', 'loudoun-county-va', 'madison', 'milwaukee', 'new-orleans', 'pittsburgh', 'portland', 'portland-maine', 'prince-georges-county-md', 'providence', 'san-francisco', 'santa-fe', 'seattle', 'sedona-arizona', 'tempe', 'washington-dc'].map((region) => `./regions/${region}/osm/merged-pois.json`),
  './regions/washington-dc/geography/neighborhoods.geojson', './regions/washington-dc/geography/source.json',
  // Large regional enrichments are fetched on demand after first paint. Keep
  // them out of install-time precache so PWA install is not a multi-megabyte
  // blocking download.
  './regions/fairfax-county-va/pois.json',
  './regions/fairfax-county-va/discover.json', './regions/fairfax-county-va/learn.json', './regions/fairfax-county-va/capabilities.json', './regions/fairfax-county-va/civic/index.json',
  './assets/fox-idle.gif', './assets/fox-walk.gif', './assets/cloud-idle.gif', './assets/cloud-walk.gif', './assets/compass.gif',
  './regions/washington-dc/spatial/spatial-index-manifest.json', './regions/washington-dc/spatial/pois.flatbush', './regions/washington-dc/spatial/pois.ids.json',
  './regions/washington-dc/spatial/boundaries.flatbush', './regions/washington-dc/spatial/boundaries.ids.json'
 ];
// Regional navigation remains runtime-cached. Do not add every regional POI
// pack to install-time precache: that turns a shell update into a large,
// unrelated download for devices that may only ever use one region.
shell.push('./js/regional-navigation.js', './data/regional-navigation.json');
// Large regional packs and routing artifacts are loaded only when a region
// or route is actually opened. Precaching them makes a service-worker update
// download tens of megabytes and can leave mobile browsers looking frozen.
const installShell = shell.filter((asset) => !asset.startsWith('./regions/') && !/(^|\/)(?:[^/]*-)?poi(?:s)?\.json$|(^|\/)records\.json$|(^|\/)cells\.json$|neighborhoods\.geojson$|runtime-graph\.json$|(?:fox|cloud|compass|splash)/i.test(asset));
const shellPaths = new Set(installShell.map((asset) => new URL(asset, self.registration.scope).pathname));
const libraryAssets = [
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet-markercluster/MarkerCluster.css',
  './vendor/leaflet-markercluster/MarkerCluster.Default.css',
  './vendor/leaflet-markercluster/leaflet.markercluster.js',
  './vendor/leaflet-geoman/leaflet-geoman.css',
  './vendor/leaflet-geoman/leaflet-geoman.min.js',
  './vendor/turf/turf.min.js',
  './vendor/maplibre-gl.css',
  './vendor/maplibre-gl.js',
  './vendor/pmtiles.js',
  './vendor/flatbush/flatbush.js',
  './vendor/flatbush/flatqueue.js',
  './vendor/rbush/rbush.js',
  './vendor/rbush/quickselect.js'
];


self.addEventListener('install', (event) => event.waitUntil(Promise.all([
  caches.open(APP_CACHE).then((cache) => cache.addAll(installShell)),
  caches.open(LIBRARY_CACHE).then(async (cache) => {
    await Promise.all(libraryAssets.map(async (asset) => {
      try {
        const response = await fetch(asset, { mode: 'no-cors' });
        await cache.put(asset, response);
      } catch (_) { /* The app can still install if a CDN is briefly unavailable. */ }
    }));
  })
])));

// An installed PWA keeps using its complete current shell until the page asks
// the fully-downloaded replacement to activate. IndexedDB is never touched by
// service-worker cache cleanup.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(
  Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => (
          (key.startsWith('walk-wildlife-shell-') && key !== APP_CACHE)
          || (key.startsWith('walk-wildlife-osm-viewed-tiles-') && key !== TILE_CACHE)
          || (key.startsWith('walk-wildlife-companion-media-') && key !== COMPANION_CACHE)
        ))
        .map((key) => caches.delete(key))
    )),
    self.clients.claim(),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Post first for current builds; navigate is the compatibility fallback
      // for tabs running an older app.js that does not know FORCE_RELOAD.
      return Promise.all(windows.map((client) => {
        client.postMessage({ type: 'FORCE_RELOAD', reason: 'new-app-cache' });
        return client.navigate(client.url).catch(() => null);
      }));
    })
  ])
));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isMapTile = new Set(['a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org', 'a.tile.openstreetmap.fr', 'b.tile.openstreetmap.fr', 'c.tile.openstreetmap.fr', 'a.tile.opentopomap.org', 'b.tile.opentopomap.org', 'c.tile.opentopomap.org', 'basemap.nationalmap.gov']).has(url.hostname);

  // PMTiles manages its own bounded byte-range reads. Never place an archive
  // response (partial or complete) in a service-worker cache.
  if (/\.pmtiles$/i.test(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isMapTile) {
    event.respondWith(caches.open(TILE_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') { await cache.put(event.request, response.clone()); await trimCache(cache, TILE_CACHE); }
      return response;
    }));
    return;
  }

  if (url.origin === self.location.origin && /\/assets\/[^/]+\.gif$/i.test(url.pathname)) {
    event.respondWith(caches.open(COMPANION_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok) { await cache.put(event.request, response.clone()); await trimCache(cache, COMPANION_CACHE); }
      return response;
    }));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith(libraryPath)) {
    event.respondWith(caches.open(LIBRARY_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') { await cache.put(event.request, response.clone()); await trimCache(cache, LIBRARY_CACHE); }
      return response;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.put(event.request, copy)));
          }
          return response;
        })
        .catch(async () => (await caches.match(event.request))
          || (shellPaths.has(url.pathname) ? await caches.match(`${url.origin}${url.pathname}`) : null)
          || Response.error())
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
shell.push('./regions/jacksonville/pois.json', './regions/memphis/pois.json', './regions/sacramento/pois.json', './regions/tampa/pois.json');
