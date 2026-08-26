import { state } from './state.js';
import { city } from './poi.js';
import { debounce } from './utils.js';
import { openObservation } from './observation.js';
import { openPlaceCluster, renderCityPois } from './poi.js';
import { fieldEditionLoader, regionInstaller } from './region-ui.js';
import { toast } from './ui.js';

export function initMap() {
  const active = city();
  const initialPosition = state.currentPosition || active.center;
  // When location permission is granted at startup, begin at the actual
  // location—not the regional centroid—and keep enough zoom for a walk.
  const initialZoom = state.currentPosition ? Math.max(active.zoom, 14) : active.zoom;
  state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([initialPosition.lat, initialPosition.lng], initialZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', crossOrigin: true }).addTo(state.map);
  state.historyRadiusLayer = L.layerGroup().addTo(state.map);
  const clusterOptions = (badgeClass) => ({
    chunkedLoading: true, // progressive loading: adds markers in batches off the main thread
    maxClusterRadius: 55,
    // A cluster opens a readable list instead of MarkerCluster's radial
    // spiderfy clock. Exact-coordinate records stay usable at every zoom.
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: false,
    iconCreateFunction: (cluster) => L.divIcon({ className: '', html: `<div class="cluster-badge ${badgeClass}">${cluster.getChildCount()}</div>`, iconSize: [36, 36] })
  });
  state.historyLayer = (typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup(clusterOptions('history-cluster')) : L.layerGroup()).addTo(state.map);
  state.observationLayer = L.layerGroup().addTo(state.map);
  state.poiLayer = (typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup(clusterOptions('poi-cluster')) : L.layerGroup()).addTo(state.map);
  [state.historyLayer, state.poiLayer].forEach((layer) => layer.on?.('clusterclick', (event) => {
    if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
    openPlaceCluster(event.layer, event.latlng);
  }));
  state.trailLayer = L.featureGroup().addTo(state.map);
  state.map.on('click', (event) => {
    if (state.plannerSelecting) {
      state[`planner${state.plannerSelecting}`] = { lat: event.latlng.lat, lng: event.latlng.lng };
      const selected = state.plannerSelecting;
      state.plannerSelecting = null;
      window.dispatchEvent(new CustomEvent('planner-point-selected', { detail: selected }));
      return;
    }
    if (state.planningMode) return;
    openObservation({ lat: event.latlng.lat, lng: event.latlng.lng });
  });
  // Viewport windowing: only build markers for what's on/near screen, recomputed
  // after panning/zooming settles. Stands in for server-side bbox filtering
  // until the backend described in the recommendations exists.
  state.map.on('moveend zoomend', debounce(() => renderCityPois(), 200));

  const refreshMapSize = () => {
    if (!state.map) return;
    state.map.invalidateSize({ pan: false });
  };

  state.map.whenReady(() => {
    requestAnimationFrame(refreshMapSize);
    window.setTimeout(refreshMapSize, 150);
  });

  window.addEventListener('resize', debounce(refreshMapSize, 120));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshMapSize();
  });
  if (state.currentPosition) renderUserLocation(state.currentPosition);
  window.addEventListener('field-edition-activated', ({ detail }) => activateFieldEdition(detail));
  void addFieldEditionEntry();
  // Federal boundary geometry remains available for a future visual redesign,
  // but the current borders, fills, and controls are intentionally not mounted.
}

async function activateFieldEdition(edition) {
  const bounds = edition?.metadata?.geographicBounds;
  if (!bounds) return;
  const container = document.getElementById('fieldEditionMap');
  const header = document.getElementById('fieldEditionMapHeader');
  const title = document.getElementById('fieldEditionMapTitle');
  if (!container || !header || !globalThis.maplibregl || !globalThis.pmtiles) {
    toast('The offline map renderer is unavailable.');
    return;
  }

  try {
    if (!state.fieldEditionProtocol) {
      state.fieldEditionProtocol = new globalThis.pmtiles.Protocol();
      globalThis.maplibregl.addProtocol('pmtiles', state.fieldEditionProtocol.tile);
    }
    const sourceUrl = await fieldEditionSource(edition);
    state.fieldEditionMap?.remove();
    container.replaceChildren();
    container.classList.remove('hidden');
    header.classList.remove('hidden');
    title.textContent = edition.metadata?.title || edition.name || 'Field Edition';

    state.fieldEditionMap = new globalThis.maplibregl.Map({
      container,
      style: fieldEditionStyle(sourceUrl),
      bounds: [[bounds.west, bounds.south], [bounds.east, bounds.north]],
      fitBoundsOptions: { padding: 28, maxZoom: 17 },
      attributionControl: false,
      preserveDrawingBuffer: false
    });
    state.fieldEditionMap.addControl(new globalThis.maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  } catch (error) {
    console.error('Unable to open Field Edition PMTiles:', error);
    toast('The installed Field Edition map could not be opened.');
  }
}

async function fieldEditionSource(edition) {
  const file = await regionInstaller.opfs.readFile(edition.mapSource.path);
  if (!file) throw new Error('Installed PMTiles file is missing.');
  const archive = new globalThis.pmtiles.PMTiles(new globalThis.pmtiles.FileSource(file));
  state.fieldEditionProtocol.add(archive);
  return `pmtiles://${file.name}`;
}

function fieldEditionStyle(sourceUrl) {
  const source = { type: 'vector', url: sourceUrl };
  return {
    version: 8,
    sources: { field: source },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': '#edf1e4' } },
      { id: 'landuse', type: 'fill', source: 'field', 'source-layer': 'landuse', paint: { 'fill-color': '#e1ead6', 'fill-opacity': 0.9 } },
      { id: 'park', type: 'fill', source: 'field', 'source-layer': 'park', paint: { 'fill-color': '#cde0b9', 'fill-opacity': 0.92 } },
      { id: 'water', type: 'fill', source: 'field', 'source-layer': 'water', paint: { 'fill-color': '#a9d0df', 'fill-opacity': 0.95 } },
      { id: 'waterway', type: 'line', source: 'field', 'source-layer': 'waterway', paint: { 'line-color': '#80b9cf', 'line-width': 1.4 } },
      { id: 'building', type: 'fill', source: 'field', 'source-layer': 'building', minzoom: 15, paint: { 'fill-color': '#e4d8c4', 'fill-outline-color': '#cfbea6' } },
      { id: 'roads-casing', type: 'line', source: 'field', 'source-layer': 'transportation', paint: { 'line-color': '#f7f3ea', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 6] } },
      { id: 'roads', type: 'line', source: 'field', 'source-layer': 'transportation', paint: { 'line-color': '#b39f7d', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 18, 3.2] } }
    ]
  };
}

function exitFieldEdition() {
  state.fieldEditionMap?.remove();
  state.fieldEditionMap = null;
  document.getElementById('fieldEditionMap')?.classList.add('hidden');
  document.getElementById('fieldEditionMapHeader')?.classList.add('hidden');
  state.map?.invalidateSize({ pan: false });
}

async function addFieldEditionEntry() {
  const editions = await fieldEditionLoader.discoverAvailable().catch((error) => {
    console.warn('Field Edition catalogue unavailable:', error);
    return [];
  });
  if (!editions.length || !state.map) return;
  state.fieldEditionEntryLayer?.clearLayers();
  state.fieldEditionEntryLayer = L.layerGroup().addTo(state.map);
  editions.filter((edition) => edition.bounds).forEach((edition) => {
    const { west, south, east, north } = edition.bounds;
    const marker = L.marker([(south + north) / 2, (west + east) / 2], {
      icon: L.divIcon({ className: '', html: '<div class="field-edition-entry-marker">🌿</div>', iconSize: [42, 42], iconAnchor: [21, 21] }),
      title: `Open ${edition.title || edition.id}`
    }).bindTooltip(edition.title || edition.id, { direction: 'top', offset: [0, -20] });
    marker.on('click', async () => {
      try { await fieldEditionLoader.loadEdition(edition.id); toast(`${edition.title || edition.id} package installed.`); }
      catch (error) { toast(error.message || 'Field Edition is not available yet.'); }
    });
    marker.addTo(state.fieldEditionEntryLayer);
  });
}
export function renderUserLocation(point, pan = false) {
  state.currentPosition = point;
  window.dispatchEvent(new CustomEvent('field-edition-location'));
  const icon = L.divIcon({ className: '', html: '<div class="user-marker" role="img" aria-label="Your location"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!state.userMarker) state.userMarker = L.marker([point.lat, point.lng], { icon, zIndexOffset: 1000, title: 'Your location' }).addTo(state.map);
  else state.userMarker.setLatLng([point.lat, point.lng]);
  if (pan) state.map.panTo([point.lat, point.lng]);
}

document.getElementById('exitFieldEditionButton')?.addEventListener('click', exitFieldEdition);
