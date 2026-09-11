import { state } from './state.js';
import { city } from './poi.js';
import { debounce } from './utils.js';
import { renderCityPois } from './poi.js';
import { regionInstaller } from './region-ui.js';
import { toast } from './ui.js';
import { placeLight } from './place-details.js';
import { createNationalPoiArchive, fetchOsmReleaseManifest } from './osm-release.js';
import {
  NATIONAL_POI_QUERY_LAYERS,
  nationalPoiLayerFilters,
  nationalPoiFeatureDetails,
  nationalPoiStyle,
  nationalPoiSymbolLayers,
  registerNationalPoiIcons
} from './national-poi-map.js';
import { enabledNationalOsmLayerIds, hasEnabledNationalOsmLayers } from './national-osm-layers.js';

const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const mapLibreZoom = () => Math.max(0, (state.map?.getZoom() || 0) - 1);

export function initMap() {
  const active = city();
  const view = state.offlineView;
  const offlineCenter = view?.range?.type === 'radius' ? view.range.center : view?.range?.bbox ? { lat: (view.range.bbox.south + view.range.bbox.north) / 2, lng: (view.range.bbox.west + view.range.bbox.east) / 2 } : null;
  const initialPosition = offlineCenter || state.currentPosition || state.lastPosition || active.center;
  // When location permission is granted at startup, begin at the actual
  // location—not the regional centroid—and keep enough zoom for a walk.
  const initialZoom = view?.zoom ?? ((state.currentPosition || state.lastPosition) ? Math.max(active.zoom, 15) : active.zoom);
  state.map = L.map('map', { zoomControl: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false }).setView([initialPosition.lat, initialPosition.lng], initialZoom);
  state.onlineBasemapLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTRIBUTION, crossOrigin: true });
  if (navigator.onLine !== false) state.onlineBasemapLayer.addTo(state.map);
  state.historyRadiusLayer = L.layerGroup().addTo(state.map);
  state.observationLayer = L.layerGroup().addTo(state.map);
  state.poiLayer = (L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 42, disableClusteringAtZoom: 17, showCoverageOnHover: false, iconCreateFunction: (cluster) => {
    const counts = { news: 0, recreation: 0, cuisine: 0 };
    cluster.getAllChildMarkers().forEach((marker) => { counts[placeLight(marker.options.place || {})] += 1; });
    const light = Object.keys(counts).sort((a,b) => counts[b] - counts[a])[0];
    const color = { news: '#8b3a4a', recreation: '#2d7259', cuisine: '#c65d0e' }[light];
    return L.divIcon({ className: 'place-cluster', html: `<span style="--cluster-color:${color}">${cluster.getChildCount()}</span>`, iconSize: [36,36] });
  } }) : L.layerGroup()).addTo(state.map);
  state.historyLayer = state.poiLayer;
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
    if (showNationalPoiDetails(event)) return;
    window.dispatchEvent(new CustomEvent('map-context-requested', { detail: { lat: event.latlng.lat, lng: event.latlng.lng } }));
  });
  // Viewport windowing: only build markers for what's on/near screen, recomputed
  // after panning/zooming settles. Stands in for server-side bbox filtering
  // until the backend described in the recommendations exists.
  state.map.on('moveend zoomend', debounce(() => {
    renderCityPois();
    window.dispatchEvent(new CustomEvent('map-viewport-changed'));
  }, 200));

  const refreshMapSize = () => {
    if (!state.map) return;
    state.map.invalidateSize({ pan: false });
    state.nationalPoiMap?.resize();
  };

  state.map.whenReady(() => {
    requestAnimationFrame(refreshMapSize);
    window.setTimeout(refreshMapSize, 150);
    void activateNationalPoiOverlay();
  });

  window.addEventListener('resize', debounce(refreshMapSize, 120));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshMapSize();
  });
  if (state.currentPosition) renderUserLocation(state.currentPosition);
  window.addEventListener('field-edition-activated', ({ detail }) => activateFieldEdition(detail));
  window.addEventListener('installed-region-activated', ({ detail }) => void activateInstalledBasemap(detail));
  window.addEventListener('online', () => void activateInstalledBasemap(state.installedBasemapRegion));
  window.addEventListener('offline', () => void activateInstalledBasemap(state.installedBasemapRegion));
  window.addEventListener('national-osm-layers-changed', () => {
    if (!hasEnabledNationalOsmLayers()) { deactivateNationalPoiOverlay(); return; }
    if (state.nationalPoiMap) applyNationalPoiLayerFilters();
    else void activateNationalPoiOverlay();
  });
  // Federal boundary geometry remains available for a future visual redesign,
  // but the current borders, fills, and controls are intentionally not mounted.
}

function ensurePmtilesProtocol() {
  if (!state.pmtilesProtocol) {
    state.pmtilesProtocol = new globalThis.pmtiles.Protocol();
    globalThis.maplibregl.addProtocol('pmtiles', state.pmtilesProtocol.tile);
  }
  state.installedBasemapProtocol = state.pmtilesProtocol;
  state.fieldEditionProtocol = state.pmtilesProtocol;
  return state.pmtilesProtocol;
}

export async function activateNationalPoiOverlay({ manifest = null } = {}) {
  const container = document.getElementById('nationalPoiOverlay');
  if (!container || !state.map || !hasEnabledNationalOsmLayers() || state.nationalPoiSuppressed || navigator.onLine === false || !globalThis.maplibregl || !globalThis.pmtiles) return false;
  if (state.nationalPoiMap) { applyNationalPoiLayerFilters(); return true; }
  if (state.nationalPoiActivating) return false;
  if (!manifest && !globalThis.WALK_WILDLIFE_SUPABASE?.osmReleaseManifestUrl) return false;
  state.nationalPoiActivating = true;
  try {
    const release = manifest || await fetchOsmReleaseManifest();
    if (state.nationalPoiSuppressed) return false;
    const national = createNationalPoiArchive(release);
    if (!national) return false;
    const protocol = ensurePmtilesProtocol();
    protocol.add(national.archive);
    deactivateNationalPoiOverlay();
    container.replaceChildren();
    container.classList.remove('hidden');
    const center = state.map.getCenter();
    const map = new globalThis.maplibregl.Map({
      container,
      style: nationalPoiStyle(`pmtiles://${national.url}`, enabledNationalOsmLayerIds()),
      center: [center.lng, center.lat],
      zoom: mapLibreZoom(),
      attributionControl: false,
      interactive: false,
      fadeDuration: 0,
      localFontFamily: 'system-ui'
    });
    state.nationalPoiMap = map;
    state.nationalPoiSync = () => {
      const next = state.map?.getCenter();
      if (next && state.nationalPoiMap) state.nationalPoiMap.jumpTo({ center: [next.lng, next.lat], zoom: mapLibreZoom(), bearing: 0, pitch: 0 });
    };
    state.map.on('move zoom', state.nationalPoiSync);
    map.once('style.load', async () => {
      if (state.nationalPoiMap !== map || state.nationalPoiSuppressed) return;
      state.nationalPoiSync();
      enableNationalMapPresentation();
      const [iconLayer, ...labelLayers] = nationalPoiSymbolLayers(enabledNationalOsmLayerIds());
      try {
        await registerNationalPoiIcons(map);
        if (state.nationalPoiMap === map && !map.getLayer(iconLayer.id)) map.addLayer(iconLayer);
      } catch (error) {
        console.warn('National walking-place icons unavailable:', error);
      }
      if (state.nationalPoiMap === map) {
        labelLayers.forEach((layer) => { if (!map.getLayer(layer.id)) map.addLayer(layer); });
        applyNationalPoiLayerFilters();
      }
    });
    return true;
  } catch (error) {
    deactivateNationalPoiOverlay();
    console.warn('National walking places unavailable:', error);
    return false;
  } finally {
    state.nationalPoiActivating = false;
  }
}

function enableNationalMapPresentation() {
  const shell = document.querySelector('.app-shell');
  shell?.classList.add('national-map-active');
  if (state.onlineBasemapLayer && state.map.hasLayer(state.onlineBasemapLayer)) state.map.removeLayer(state.onlineBasemapLayer);
  if (!state.nationalPoiAttribution) {
    state.map.attributionControl.addAttribution(OSM_ATTRIBUTION);
    state.nationalPoiAttribution = true;
  }
}

export function deactivateNationalPoiOverlay({ restoreOnlineBasemap = true } = {}) {
  if (state.nationalPoiSync && state.map) state.map.off('move zoom', state.nationalPoiSync);
  state.nationalPoiSync = null;
  state.nationalPoiMap?.remove();
  state.nationalPoiMap = null;
  const container = document.getElementById('nationalPoiOverlay');
  container?.replaceChildren();
  container?.classList.add('hidden');
  document.querySelector('.app-shell')?.classList.remove('national-map-active');
  if (state.nationalPoiAttribution && state.map) {
    state.map.attributionControl.removeAttribution(OSM_ATTRIBUTION);
    state.nationalPoiAttribution = false;
  }
  if (restoreOnlineBasemap && navigator.onLine !== false && state.onlineBasemapLayer && state.map && !state.map.hasLayer(state.onlineBasemapLayer)) {
    state.onlineBasemapLayer.addTo(state.map);
  }
}

export function applyNationalPoiLayerFilters() {
  const map = state.nationalPoiMap;
  if (!map) return;
  const filters = nationalPoiLayerFilters(enabledNationalOsmLayerIds());
  Object.entries(filters).forEach(([layerId, filter]) => { if (map.getLayer(layerId)) map.setFilter(layerId, filter); });
}

function showNationalPoiDetails(event) {
  const map = state.nationalPoiMap;
  if (!map) return false;
  const availableLayers = NATIONAL_POI_QUERY_LAYERS.filter((id) => map.getLayer(id));
  if (!availableLayers.length) return false;
  const { x, y } = event.containerPoint;
  let features = [];
  try {
    const offsets = [[0, 0], [-10, 0], [10, 0], [0, -10], [0, 10], [-8, -8], [8, -8], [-8, 8], [8, 8]];
    features = offsets.flatMap(([dx, dy]) => map.queryRenderedFeatures([x + dx, y + dy], { layers: availableLayers }));
  } catch {
    return false;
  }
  const feature = features.find((candidate) => candidate?.properties);
  if (!feature) return false;
  const details = nationalPoiFeatureDetails(feature.properties);
  if (!state.nationalOsmLayers[details.categoryId]) return false;
  const card = document.createElement('article');
  card.className = 'national-poi-card';
  card.style.setProperty('--poi-color', details.color);
  const heading = document.createElement('header');
  const icon = document.createElement('img');
  icon.src = new URL(`../icons/${details.icon}.svg`, import.meta.url).href;
  icon.alt = '';
  const title = document.createElement('div');
  const kicker = document.createElement('small');
  kicker.textContent = details.category;
  const name = document.createElement('strong');
  name.textContent = details.name;
  title.append(kicker, name);
  heading.append(icon, title);
  card.append(heading);
  if (details.subcategory && details.subcategory.toLocaleLowerCase() !== details.name.toLocaleLowerCase()) {
    const subtype = document.createElement('p');
    subtype.textContent = details.subcategory;
    card.append(subtype);
  }
  if (details.qualities.length) {
    const qualities = document.createElement('dl');
    details.qualities.forEach((quality) => {
      const term = document.createElement('dt');
      term.textContent = quality.label;
      const value = document.createElement('dd');
      value.textContent = quality.value;
      qualities.append(term, value);
    });
    card.append(qualities);
  }
  const source = document.createElement('small');
  source.className = 'national-poi-source';
  source.textContent = `${details.source} · walking-v3`;
  card.append(source);
  if (details.osmId && /^(node|way|relation)\/\d+$/.test(details.osmId)) {
    const link = document.createElement('a');
    link.href = `https://www.openstreetmap.org/${details.osmId}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'View on OpenStreetMap ↗';
    card.append(link);
  }
  L.popup({ className: 'national-poi-popup', maxWidth: 310 }).setLatLng(event.latlng).setContent(card).openOn(state.map);
  return true;
}

export async function activateInstalledBasemap(region) {
  const container = document.getElementById('installedBasemap');
  if (!container || !state.map) return false;
  state.installedBasemapRegion = region || null;
  const regionAvailable = Boolean(region?.ready && region.mapSource?.type === 'opfs');
  const useInstalledBasemap = regionAvailable && navigator.onLine === false;
  state.nationalPoiSuppressed = useInstalledBasemap;
  if (useInstalledBasemap) deactivateNationalPoiOverlay({ restoreOnlineBasemap: false });
  if (state.installedBasemapSync) {
    state.map.off('move zoom', state.installedBasemapSync);
    state.installedBasemapSync = null;
  }
  state.installedBasemapMap?.remove();
  state.installedBasemapMap = null;
  container.replaceChildren();
  container.classList.add('hidden');
  document.querySelector('.app-shell')?.classList.remove('installed-map-active');
  if (!useInstalledBasemap) {
    state.nationalPoiSuppressed = false;
    if (navigator.onLine !== false) void activateNationalPoiOverlay();
    return false;
  }
  if (!globalThis.maplibregl || !globalThis.pmtiles) return false;
  try {
    const file = await regionInstaller.opfs.readFile(region.mapSource.path);
    if (!file) throw new Error('Installed PMTiles file is missing.');
    ensurePmtilesProtocol();
    const archive = new globalThis.pmtiles.PMTiles(new globalThis.pmtiles.FileSource(file));
    state.installedBasemapProtocol.add(archive);
    state.map.removeLayer(state.onlineBasemapLayer);
    container.classList.remove('hidden');
    document.querySelector('.app-shell')?.classList.add('installed-map-active');
    const center = state.map.getCenter();
    state.installedBasemapMap = new globalThis.maplibregl.Map({
      container,
      style: fieldEditionStyle(`pmtiles://${file.name}`),
      center: [center.lng, center.lat],
      zoom: mapLibreZoom(),
      attributionControl: false,
      interactive: false,
      fadeDuration: 0
    });
    state.installedBasemapSync = () => {
      if (!state.installedBasemapMap) return;
      const next = state.map.getCenter();
      state.installedBasemapMap.jumpTo({ center: [next.lng, next.lat], zoom: mapLibreZoom(), bearing: 0, pitch: 0 });
    };
    state.map.on('move zoom', state.installedBasemapSync);
    state.installedBasemapMap.once('load', state.installedBasemapSync);
    return true;
  } catch (error) {
    state.nationalPoiSuppressed = false;
    console.warn('Installed PMTiles basemap unavailable:', error);
    container.classList.add('hidden');
    document.querySelector('.app-shell')?.classList.remove('installed-map-active');
    if (navigator.onLine !== false && state.onlineBasemapLayer && !state.map.hasLayer(state.onlineBasemapLayer)) state.onlineBasemapLayer.addTo(state.map);
    if (navigator.onLine !== false) void activateNationalPoiOverlay();
    if (navigator.onLine === false) toast('Installed streets are unavailable. Pack pins remain; no new area will be fetched.');
    return false;
  }
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
    ensurePmtilesProtocol();
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

export function renderUserLocation(point, pan = false) {
  state.currentPosition = point;
  window.dispatchEvent(new CustomEvent('field-edition-location'));
  const icon = L.divIcon({ className: '', html: '<div class="user-marker" role="img" aria-label="Your location"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!state.userMarker) state.userMarker = L.marker([point.lat, point.lng], { icon, zIndexOffset: 1000, title: 'Your location' }).addTo(state.map);
  else state.userMarker.setLatLng([point.lat, point.lng]);
  if (pan) state.map.panTo([point.lat, point.lng]);
}

document.getElementById('exitFieldEditionButton')?.addEventListener('click', exitFieldEdition);
