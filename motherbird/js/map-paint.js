import { state } from './state.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import db from './storage.js';

let activeLine = null;
let drawing = false;

function setActive(active) {
  state.mapPaintActive = active;
  document.body.classList.toggle('map-painting', active);
  el('mapPencilButton')?.setAttribute('aria-pressed', String(active));
  state.map?.dragging?.[active ? 'disable' : 'enable']();
  if (!active) drawing = false;
}

export function validDrawing(points) {
  return Array.isArray(points) && points.length > 1 && points.length <= 20000 && points.every((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180);
}
export async function renderMapDrawings() {
  if (!state.mapPaintLayer) return;
  state.mapPaintLayer.clearLayers();
  for (const item of await db.all('moments')) {
    if (item.city && item.city !== state.activeCity) continue;
    if (item.type === 'drawing' && validDrawing(item.body?.coordinates)) L.polyline(item.body.coordinates, { color: '#76558b', weight: 4, opacity: .85 }).addTo(state.mapPaintLayer);
    if (item.type === 'friend-pin' && Number.isFinite(item.body?.location?.lat) && Number.isFinite(item.body?.location?.lng)) L.circleMarker([item.body.location.lat, item.body.location.lng], { color: '#76558b', radius: 7 }).bindTooltip(String(item.body.name || 'Friend pin').replace(/[<>]/g, '')).addTo(state.mapPaintLayer);
  }
}
export async function initMapPaint() {
  const button = el('mapPencilButton');
  const container = state.map?.getContainer?.();
  if (!button || !container) return;
  state.mapPaintLayer = L.layerGroup().addTo(state.map);
  const friendLayer = L.layerGroup().addTo(state.map);
  await renderMapDrawings();
  window.addEventListener('local-drawings-changed', () => void renderMapDrawings());
  window.addEventListener('city-layer-data-changed', () => void renderMapDrawings());
  window.addEventListener('friend-walk-tickets', ({ detail }) => {
    friendLayer.clearLayers();
    for (const ticket of detail || []) {
      if (ticket.kind === 'draw' && validDrawing(ticket.body?.coordinates)) L.polyline(ticket.body.coordinates, { color: '#8b3a4a', weight: 4 }).addTo(friendLayer);
      if (ticket.kind === 'pin' && Number.isFinite(ticket.body?.location?.lat) && Number.isFinite(ticket.body?.location?.lng)) L.circleMarker([ticket.body.location.lat, ticket.body.location.lng], { color: '#8b3a4a', radius: 7 }).addTo(friendLayer);
    }
  });
  button.addEventListener('click', () => {
    setActive(!state.mapPaintActive);
    toast(state.mapPaintActive ? 'Draw on the map with a finger or pointer. Tap Draw again when finished.' : 'Map sketch finished.');
  });
  container.addEventListener('pointerdown', (event) => {
    if (!state.mapPaintActive || event.button > 0) return;
    event.preventDefault();
    drawing = true;
    container.setPointerCapture?.(event.pointerId);
    const point = state.map.mouseEventToLatLng(event);
    activeLine = L.polyline([[point.lat, point.lng]], { color: '#e8740f', weight: 5, opacity: .85, lineCap: 'round', interactive: false }).addTo(state.mapPaintLayer);
  });
  container.addEventListener('pointermove', (event) => {
    if (!drawing || !activeLine) return;
    event.preventDefault();
    const point = state.map.mouseEventToLatLng(event);
    const points = activeLine.getLatLngs();
    const last = points.at(-1);
    if (!last || Math.abs(last.lat - point.lat) + Math.abs(last.lng - point.lng) > 0.00001) activeLine.addLatLng(point);
  });
  const finish = async (event) => {
    if (!drawing) return;
    drawing = false;
    container.releasePointerCapture?.(event.pointerId);
    const coordinates = activeLine?.getLatLngs().map((point) => [point.lat, point.lng]) || [];
    activeLine = null;
    if (!validDrawing(coordinates)) return;
    const body = { coordinates };
    try {
      if (state.friendWalk) { const { addFriendTicket } = await import('./friend-walk.js'); await addFriendTicket('draw', body); }
      else await db.put('moments', { id: crypto.randomUUID(), type: 'drawing', title: 'Map drawing', city: state.activeCity, createdAt: new Date().toISOString(), body });
      await renderMapDrawings();
    } catch (error) { toast(error.message || 'Drawing could not be saved.'); }
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);
}
