import { state } from './state.js';
import { el, cityLabel } from './utils.js';
import { toast } from './ui.js';
import db from './storage.js';
import { displayPoiName, isVisiblePoi, poiTags } from './poi.js';
import { markerPinHtml, markerVisual } from './poi-icons.js';
import { generateTimeBasedPlan } from './planner.js';
import { normalizePersonalCategory, upsertImportedPersonalData } from './personal-places.js';
import { savePlannedRoute } from './saved-routes.js';
import { createSpatialQuery, listSpatialQueries, queryPrompt, saveSpatialQuery } from './spatial-query.js';

const DRAW_COLOR = '#76558b';
function readHiddenArtifacts() {
  try {
    const saved = JSON.parse(typeof localStorage === 'undefined' ? '[]' : (localStorage.getItem('hiddenMapArtifacts') || '[]'));
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function saveHiddenArtifacts() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('hiddenMapArtifacts', JSON.stringify([...hiddenArtifacts])); }
  catch { /* Map drawing stays usable when browser storage is unavailable. */ }
}

const hiddenArtifacts = readHiddenArtifacts();
let freehandActive = false;
function queryCategory(poi) {
  const tags = poiTags(poi);
  if (tags.includes('event')) return 'news';
  if (tags.some((tag) => ['coffee', 'coffee_shop', 'cafe', 'market', 'farmers_market', 'grocery', 'supermarket', 'convenience', 'restaurant', 'fast_food'].includes(tag))) return 'cuisine';
  if (tags.some((tag) => ['park', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad', 'trail', 'history', 'history_landmark', 'history_monument', 'history_museum', 'history_cemetery', 'history_marker', 'art', 'public_art'].includes(tag))) return 'recreation';
  return null;
}
function queryGeometry(query) {
  if (!query?.geometry) return null;
  if (['LineString', 'MultiLineString'].includes(query.geometry.type) && globalThis.turf?.buffer) {
    return globalThis.turf.buffer({ type: 'Feature', properties: {}, geometry: query.geometry }, 100, { units: 'meters' })?.geometry || null;
  }
  return query.geometry;
}
export function restoreSpatialQuery(query) {
  if (!query) return;
  state.spatialQuery = query;
  state.spatialQueryDismissed = new Set();
  state.spatialQuerySelected = new Set();
  renderSpatialQuery();
}

function renderSpatialQuery() {
  if (!state.map || !state.spatialQuery) return;
  if (!state.spatialQueryLayer) state.spatialQueryLayer = L.layerGroup().addTo(state.map);
  state.spatialQueryLayer.clearLayers();
  const geometry = queryGeometry(state.spatialQuery);
  const results = (state.cityPois[state.activeCity] || []).filter(isVisiblePoi).filter((poi) => {
    const category = queryCategory(poi);
    if (!category || state.layerLights?.[category] === false) return false;
    if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') return globalThis.turf?.booleanPointInPolygon([poi.lng, poi.lat], geometry);
    return false;
  }).filter((poi) => !state.spatialQueryDismissed.has(String(poi.id)));
  state.spatialQueryResults = results;
  const resultIds = results.map((poi) => String(poi.id));
  if (state.spatialQuery.status !== 'ready' || JSON.stringify(state.spatialQuery.resultIds || []) !== JSON.stringify(resultIds)) {
    state.spatialQuery = { ...state.spatialQuery, status: 'ready', resultIds };
    void saveSpatialQuery(state.spatialQuery).then(() => renderSpatialQueryHistory());
  }
  results.forEach((poi) => {
    const category = queryCategory(poi);
    const marker = L.marker([poi.lat, poi.lng], { icon: L.divIcon({ className: '', html: markerPinHtml(markerVisual({ poi, light: category })), iconSize: [27, 27], iconAnchor: [13, 13] }) });
    const id = String(poi.id).replace(/[^\w:-]/g, '');
    const selected = state.spatialQuerySelected.has(String(poi.id));
    marker.bindPopup(`<strong>${String(displayPoiName(poi)).replace(/[<>]/g, '')}</strong><small>Spatial Query · ${category || 'place'}</small><div class="spatial-query-actions"><button type="button" data-query-save="${id}">Save</button><button type="button" data-query-discover="${id}">Add to Discover</button><button type="button" data-query-dismiss="${id}">Dismiss</button><button type="button" data-query-route="${id}">Route</button><label><input type="checkbox" data-query-select="${id}" ${selected ? 'checked' : ''}/> Walk stop</label></div>`);
    marker.on('popupopen', () => {
      const root = marker.getPopup()?.getElement(); if (!root) return;
      root.querySelector('[data-query-save]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('personal-place-create-requested', { detail: { sourcePoi: poi, location: { lat: poi.lat, lng: poi.lng }, name: displayPoiName(poi) } })));
      root.querySelector('[data-query-discover]')?.addEventListener('click', async () => {
        const categoryName = 'Discover';
        const categoryId = 'discover';
        const detail = { sourcePoi: poi, location: { lat: poi.lat, lng: poi.lng }, name: displayPoiName(poi), categoryId, categoryName };
        window.dispatchEvent(new CustomEvent('personal-place-create-requested', { detail }));
      });
      root.querySelector('[data-query-dismiss]')?.addEventListener('click', () => { state.spatialQueryDismissed.add(String(poi.id)); marker.closePopup(); renderSpatialQuery(); });
      root.querySelector('[data-query-route]')?.addEventListener('click', () => { document.querySelector('input[name="routeMode"][value="point-to-point"]')?.click(); state.plannerEnd = { lat: poi.lat, lng: poi.lng }; window.dispatchEvent(new CustomEvent('planner-point-selected')); });
      root.querySelector('[data-query-select]')?.addEventListener('change', (event) => { event.target.checked ? state.spatialQuerySelected.add(String(poi.id)) : state.spatialQuerySelected.delete(String(poi.id)); renderSpatialQuery(); });
    });
    marker.addTo(state.spatialQueryLayer);
  });
  const status = el('drawWorkspaceStatus');
  if (status && state.spatialQuery) {
    const button = status.querySelector('[data-query-walk-selected]') || document.createElement('button');
    button.type = 'button'; button.dataset.queryWalkSelected = 'true'; button.className = 'secondary-button'; button.textContent = `Start walk with ${state.spatialQuerySelected.size} selected place${state.spatialQuerySelected.size === 1 ? '' : 's'}`; button.disabled = state.spatialQuerySelected.size < 2;
    button.onclick = () => { const stops = state.spatialQueryResults.filter((poi) => state.spatialQuerySelected.has(String(poi.id))); document.querySelector('input[name="routeMode"][value="auto-round-trip"]')?.click(); void generateTimeBasedPlan({ stops, title: 'Spatial Query walk', reason: `Spatial Query · ${stops.length} selected places` }); };
    if (!button.parentElement) status.append(button);
    const save = status.querySelector('[data-query-save-discover]') || document.createElement('button');
    save.type = 'button'; save.dataset.querySaveDiscover = 'true'; save.className = 'secondary-button'; save.textContent = 'Save selected to Discover'; save.disabled = state.spatialQuerySelected.size < 1;
    save.onclick = async () => {
      const selected = state.spatialQueryResults.filter((poi) => state.spatialQuerySelected.has(String(poi.id)));
      if (!selected.length) return;
      const title = window.prompt('Name this Discover experience', state.plannedRoute?.title || 'Spatial Query walk');
      if (title === null) return;
      try {
        const baseId = `discover-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'experience'}`;
        let categoryId = baseId; let suffix = 2;
        while (state.personalPlaceCategories.some((item) => item.id === categoryId)) categoryId = `${baseId}-${suffix++}`;
        const category = normalizePersonalCategory({ id: categoryId, name: title, icon: 'walk', color: '#76558b', description: 'Saved Discover experience.' });
        await db.put('personal_place_categories', category);
        state.personalPlaceCategories.push(category);
        state.layerFilters.personal[category.id] = true;
        await upsertImportedPersonalData([], selected.map((poi) => ({ id: `discover:${poi.id}`, name: displayPoiName(poi), location: { lat: poi.lat, lng: poi.lng }, categoryId: category.id, sourcePoiId: poi.id, packId: state.activeCity, state: 'saved', private: true })), 'skip');
        if (state.plannedRoute?.coordinates?.length >= 2) await savePlannedRoute(state.plannedRoute, { title, discoverCategoryId: category.id, notes: `Spatial Query · ${selected.length} selected places` });
        toast(state.plannedRoute?.coordinates?.length >= 2 ? 'Discover walk saved.' : 'Discover collection saved.');
      } catch (error) { toast(error.message || 'Discover experience could not be saved.'); }
    };
    if (!save.parentElement) status.append(save);
  }
}

function setActive(active) {
  state.mapPaintActive = active;
  document.body.classList.toggle('map-painting', active);
  el('mapPencilButton')?.setAttribute('aria-pressed', String(active));
  el('fieldGuideDropdown')?.classList.add('hidden');
  el('settingsButton')?.setAttribute('aria-expanded', 'false');
  if (active) state.map?.pm?.enableDraw('Polygon', { snappable: true, finishOn: 'dblclick' });
  else state.map?.pm?.disableDraw();
}

export function validDrawing(points) {
  return Array.isArray(points) && points.length > 1 && points.length <= 20000 && points.every((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180);
}

function geometryMeasurement(geojson) {
  if (!globalThis.turf || !geojson?.geometry) return '';
  const type = geojson.geometry.type;
  if (type === 'LineString' || type === 'MultiLineString') {
    const km = globalThis.turf.length(geojson, { units: 'kilometers' });
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
  }
  if (type === 'Polygon' || type === 'MultiPolygon') {
    const squareMeters = globalThis.turf.area(geojson);
    return squareMeters < 1_000_000 ? `${Math.round(squareMeters).toLocaleString()} m²` : `${(squareMeters / 1_000_000).toFixed(2)} km²`;
  }
  return '';
}

function decorateLayer(layer, measurement = '') {
  layer.setStyle?.({ color: DRAW_COLOR, weight: 4, opacity: .85, fillColor: '#9b83aa', fillOpacity: .16 });
  if (measurement) layer.bindTooltip(measurement, { permanent: false, className: 'drawing-measure' });
  return layer;
}

export async function renderMapDrawings() {
  if (!state.mapPaintLayer) return;
  state.mapPaintLayer.clearLayers();
  state.mapDrawingHistory = [];
  const moments = await db.all('moments');
  state.localDrawings = moments.filter((item) => item.type === 'drawing' && (!item.city || item.city === state.activeCity));
  for (const item of moments) {
    if (item.city && item.city !== state.activeCity) continue;
    if (hiddenArtifacts.has(item.id)) continue;
    if (item.type === 'drawing' && item.body?.geojson) {
      L.geoJSON(item.body.geojson, { onEachFeature: (_feature, layer) => decorateLayer(layer, item.body.measurement) }).eachLayer((layer) => state.mapPaintLayer.addLayer(layer));
      state.mapDrawingHistory.push(item.id);
    } else if (item.type === 'drawing' && validDrawing(item.body?.coordinates)) {
      decorateLayer(L.polyline(item.body.coordinates), item.body.measurement).addTo(state.mapPaintLayer);
      state.mapDrawingHistory.push(item.id);
    }
    if (item.type === 'friend-pin' && Number.isFinite(item.body?.location?.lat) && Number.isFinite(item.body?.location?.lng)) L.circleMarker([item.body.location.lat, item.body.location.lng], { color: DRAW_COLOR, radius: 7 }).bindTooltip(String(item.body.name || 'Friend pin').replace(/[<>]/g, '')).addTo(state.mapPaintLayer);
  }
  renderArtifactList();
}
function renderArtifactList() {
  const list = el('mapArtifactList'); if (!list) return;
  list.replaceChildren();
  for (const item of state.localDrawings || []) {
    const row = document.createElement('article');
    const name = document.createElement('strong'); name.textContent = item.title || 'Drawing';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = hiddenArtifacts.has(item.id) ? 'Show' : 'Hide';
    toggle.addEventListener('click', () => { hiddenArtifacts.has(item.id) ? hiddenArtifacts.delete(item.id) : hiddenArtifacts.add(item.id); saveHiddenArtifacts(); void renderMapDrawings(); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${name.textContent}`);
    remove.addEventListener('click', async () => { await db.remove('moments', item.id); hiddenArtifacts.delete(item.id); void renderMapDrawings(); });
    row.append(name, toggle, remove); list.append(row);
  }
}
async function renderSpatialQueryHistory() {
  const status = el('drawWorkspaceStatus'); if (!status) return;
  let details = status.querySelector('[data-spatial-query-history]');
  if (!details) { details = document.createElement('details'); details.dataset.spatialQueryHistory = 'true'; details.className = 'spatial-query-history'; status.prepend(details); }
  const queries = (await listSpatialQueries()).filter((query) => !query.regionId || query.regionId === state.activeCity).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 8);
  details.innerHTML = `<summary>Saved Spatial Queries (${queries.length})</summary>`;
  const list = document.createElement('div');
  queries.forEach((query) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = `${query.shape} · ${query.resultIds?.length || 0} results`;
    button.addEventListener('click', () => { state.spatialQuery = query; state.spatialQueryDismissed = new Set(); state.spatialQuerySelected = new Set(); renderSpatialQuery(); }); list.append(button);
  });
  details.append(list);
}

async function persistCreatedLayer(layer, shape) {
  if (shape === 'Marker') {
    const point = layer.getLatLng?.();
    if (point) {
      layer.remove?.();
      window.dispatchEvent(new CustomEvent('personal-place-create-requested', { detail: { location: { lat: point.lat, lng: point.lng }, name: 'Pinned place' } }));
    }
    return;
  }
  let geojson = layer.toGeoJSON();
  if (shape === 'Circle' && globalThis.turf && Number.isFinite(layer.getRadius?.())) {
    const center = layer.getLatLng();
    geojson = globalThis.turf.circle([center.lng, center.lat], layer.getRadius() / 1000, { units: 'kilometers', steps: 72 });
  }
  if (['Circle', 'Polygon', 'Rectangle', 'Freehand', 'Line'].includes(shape) && geojson?.geometry) {
    const query = createSpatialQuery({ shape, geometry: geojson.geometry, regionId: state.activeCity });
    state.spatialQuery = query; state.spatialQueryDismissed = new Set(); state.spatialQuerySelected = new Set();
    void saveSpatialQuery(query).then(() => renderSpatialQueryHistory());
    if (['Circle', 'Polygon', 'Rectangle', 'Freehand', 'Line'].includes(shape)) renderSpatialQuery();
    el('drawWorkspaceStatus')?.insertAdjacentText('afterbegin', `${queryPrompt(query)} `);
    toast(`${queryPrompt(query)} Spatial Query saved.`);
  }
  const measurement = geometryMeasurement(geojson);
  try {
    await db.put('moments', { id: crypto.randomUUID(), type: 'drawing', title: `${shape || 'Map'} drawing`, city: state.activeCity, createdAt: new Date().toISOString(), body: { geojson, shape, measurement } });
    await renderMapDrawings();
    toast(measurement ? `Drawing saved · ${measurement}` : 'Drawing saved.');
  } catch (error) { toast(error.message || 'Drawing could not be saved.'); }
}

async function undoDrawing() {
  const id = state.mapDrawingHistory.at(-1);
  if (!id) { toast('Nothing to undo.'); return; }
  try { await db.remove('moments', id); await renderMapDrawings(); toast('Last drawing removed.'); }
  catch (error) { toast(error.message || 'The last drawing could not be removed.'); }
}

async function clearDrawings() {
  try {
    const drawings = (await db.all('moments')).filter((item) => item.type === 'drawing' && (!item.city || item.city === state.activeCity));
    await Promise.all(drawings.map((item) => db.remove('moments', item.id)));
    await renderMapDrawings();
    toast(drawings.length ? 'Map drawings cleared.' : 'There are no drawings to clear.');
  } catch (error) { toast(error.message || 'Drawings could not be cleared.'); }
}

function exportMapArtifacts() {
  const features = (state.localDrawings || []).map((item) => item.body?.geojson).filter(Boolean);
  const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features })], { type: 'application/geo+json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'map-artifacts.geojson'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  el('drawWorkspaceStatus')?.replaceChildren(document.createTextNode(features.length ? `Exported ${features.length} map annotation${features.length === 1 ? '' : 's'} as GeoJSON.` : 'Exported an empty GeoJSON collection.'));
}

export async function initMapPaint() {
  const button = el('mapPencilButton');
  if (!state.map) return;
  if (!state.map.pm && globalThis.L?.PM?.Map) state.map.pm = new globalThis.L.PM.Map(state.map);
  if (!state.map.pm) return;
  const drawTools = document.querySelector('.draw-shapes');
  if (drawTools && drawTools.parentElement !== document.body) {
    drawTools.classList.add('draw-tool-rail');
    document.body.append(drawTools);
  }
  const initialLabels = { Line: 'Test route', Freehand: 'Sketch area', Polygon: 'Investigate territory', Rectangle: 'Define area', Circle: 'Explore area' };
  document.querySelectorAll('[data-draw-shape]').forEach((item) => { const label = initialLabels[item.dataset.drawShape]; if (label) item.querySelector('span:last-child').textContent = label; });
  const updateRegionLabel = () => { const label = el('drawRegionLabel'); if (label) label.textContent = cityLabel(state.activeCity) || 'Installed region'; };
  updateRegionLabel();
  state.mapPaintLayer = L.featureGroup().addTo(state.map);
  const friendLayer = L.layerGroup().addTo(state.map);
  const savedQueries = (await listSpatialQueries()).filter((query) => !query.regionId || query.regionId === state.activeCity).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const latestQuery = savedQueries[0];
  if (latestQuery) {
    state.spatialQuery = latestQuery;
    state.spatialQueryDismissed = new Set();
    state.spatialQuerySelected = new Set();
  }
  await renderMapDrawings();
  if (latestQuery) renderSpatialQuery();
  await renderSpatialQueryHistory();
  globalThis.pm = globalThis.pm || {};
  globalThis.pm.map = { undo: undoDrawing, clearLayers: clearDrawings };
  state.map.on('pm:create', ({ layer, shape }) => void persistCreatedLayer(layer, shape));
  const mapNode = state.map.getContainer();
  let freehand = null;
  mapNode.addEventListener('pointerdown', (event) => {
    if (!freehandActive || event.target.closest('.leaflet-control')) return;
    event.preventDefault(); mapNode.setPointerCapture(event.pointerId); state.map.dragging.disable();
    freehand = L.polyline([state.map.mouseEventToLatLng(event)], { color: DRAW_COLOR, weight: 4 }).addTo(state.map);
  });
  mapNode.addEventListener('pointermove', (event) => { if (freehand) freehand.addLatLng(state.map.mouseEventToLatLng(event)); });
  mapNode.addEventListener('pointerup', () => {
    if (!freehand) return;
    const layer = freehand; freehand = null; state.map.dragging.enable();
    if (layer.getLatLngs().length > 1) void persistCreatedLayer(layer, 'Freehand');
    layer.remove();
  });
  window.addEventListener('local-drawings-changed', () => void renderMapDrawings());
  window.addEventListener('city-layer-data-changed', () => void renderMapDrawings());
  window.addEventListener('layer-state-dirty', renderSpatialQuery);
  window.addEventListener('spatial-query-restore-requested', ({ detail }) => restoreSpatialQuery(detail?.query));
  window.addEventListener('city-layer-data-changed', updateRegionLabel);
  window.addEventListener('friend-walk-tickets', ({ detail }) => {
    friendLayer.clearLayers();
    for (const ticket of detail || []) {
      if (ticket.kind === 'draw' && ticket.body?.geojson) L.geoJSON(ticket.body.geojson, { onEachFeature: (_feature, layer) => decorateLayer(layer, ticket.body.measurement) }).addTo(friendLayer);
      else if (ticket.kind === 'draw' && validDrawing(ticket.body?.coordinates)) decorateLayer(L.polyline(ticket.body.coordinates)).addTo(friendLayer);
      if (ticket.kind === 'pin' && Number.isFinite(ticket.body?.location?.lat) && Number.isFinite(ticket.body?.location?.lng)) L.circleMarker([ticket.body.location.lat, ticket.body.location.lng], { color: '#8b3a4a', radius: 7 }).addTo(friendLayer);
    }
  });
  document.querySelector('.draw-shapes')?.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-draw-shape]'); if (!tool) return;
    const shapes = { Marker: 'Marker', Line: 'Line', Freehand: 'Freehand', Polygon: 'Polygon', Rectangle: 'Rectangle', Circle: 'Circle' };
    const shape = shapes[tool.dataset.drawShape]; if (!shape) return;
    const labels = { Line: 'Test route', Freehand: 'Sketch area', Polygon: 'Investigate territory', Rectangle: 'Define area', Circle: 'Explore area' };
    if (labels[shape]) tool.querySelector('span:last-child').textContent = labels[shape];
    setActive(true); state.map.pm.disableDraw(); freehandActive = shape === 'Freehand';
    if (!freehandActive) state.map.pm.enableDraw(shape, { snappable: true, finishOn: 'dblclick' });
    document.querySelectorAll('[data-draw-shape]').forEach((item) => item.classList.toggle('active', item === tool));
    el('drawWorkspaceStatus').textContent = `${tool.textContent.trim()} tool active. Draw on the map.`;
  });
  el('undoMapDrawing')?.addEventListener('click', () => void undoDrawing());
  el('clearMapDrawings')?.addEventListener('click', () => void clearDrawings());
  el('hideAllMapArtifacts')?.addEventListener('click', () => {
    for (const item of state.localDrawings || []) hiddenArtifacts.add(item.id);
    saveHiddenArtifacts();
    void renderMapDrawings();
  });
  el('exportMapArtifacts')?.addEventListener('click', exportMapArtifacts);
  el('manageMapLayers')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: 'maps', forceOpen: true } })));
  window.addEventListener('map-workspace-changed', ({ detail }) => {
    const active = detail?.destination === 'draw' && detail.open;
    if (!active) { freehandActive = false; setActive(false); document.querySelectorAll('[data-draw-shape]').forEach((item) => item.classList.remove('active')); }
    else { state.mapPaintActive = true; document.body.classList.add('map-painting'); button?.setAttribute('aria-pressed', 'true'); }
  });
}
