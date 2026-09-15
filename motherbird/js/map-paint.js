import { state } from './state.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import db from './storage.js';

const DRAW_COLOR = '#76558b';
const hiddenArtifacts = new Set(JSON.parse(localStorage.getItem('hiddenMapArtifacts') || '[]'));
let freehandActive = false;

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
    toggle.addEventListener('click', () => { hiddenArtifacts.has(item.id) ? hiddenArtifacts.delete(item.id) : hiddenArtifacts.add(item.id); localStorage.setItem('hiddenMapArtifacts', JSON.stringify([...hiddenArtifacts])); void renderMapDrawings(); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${name.textContent}`);
    remove.addEventListener('click', async () => { await db.remove('moments', item.id); hiddenArtifacts.delete(item.id); void renderMapDrawings(); });
    row.append(name, toggle, remove); list.append(row);
  }
}

async function persistCreatedLayer(layer, shape) {
  let geojson = layer.toGeoJSON();
  if (shape === 'Circle' && globalThis.turf && Number.isFinite(layer.getRadius?.())) {
    const center = layer.getLatLng();
    geojson = globalThis.turf.circle([center.lng, center.lat], layer.getRadius() / 1000, { units: 'kilometers', steps: 72 });
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

export async function initMapPaint() {
  const button = el('mapPencilButton');
  if (!button || !state.map || !state.map.pm) return;
  state.mapPaintLayer = L.featureGroup().addTo(state.map);
  const friendLayer = L.layerGroup().addTo(state.map);
  await renderMapDrawings();
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
    setActive(true); state.map.pm.disableDraw(); freehandActive = shape === 'Freehand';
    if (!freehandActive) state.map.pm.enableDraw(shape, { snappable: true, finishOn: 'dblclick' });
    document.querySelectorAll('[data-draw-shape]').forEach((item) => item.classList.toggle('active', item === tool));
    el('drawWorkspaceStatus').textContent = `${tool.textContent.trim()} tool active. Draw on the map.`;
  });
  el('undoMapDrawing')?.addEventListener('click', () => void undoDrawing());
  el('clearMapDrawings')?.addEventListener('click', () => void clearDrawings());
  el('exportMapArtifacts')?.addEventListener('click', () => {
    const features = (state.localDrawings || []).map((item) => item.body?.geojson).filter(Boolean);
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features })], { type: 'application/geo+json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'map-artifacts.geojson'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  el('manageMapLayers')?.addEventListener('click', () => document.querySelector('[data-map-destination="maps"]')?.click());
  window.addEventListener('map-workspace-changed', ({ detail }) => {
    const active = detail?.destination === 'draw' && detail.open;
    if (!active) { freehandActive = false; setActive(false); document.querySelectorAll('[data-draw-shape]').forEach((item) => item.classList.remove('active')); }
    else { state.mapPaintActive = true; document.body.classList.add('map-painting'); button.setAttribute('aria-pressed', 'true'); }
  });
}
