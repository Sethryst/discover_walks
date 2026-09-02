import { state } from './state.js';
import { el } from './utils.js';
import { toast } from './ui.js';

let activeLine = null;
let drawing = false;

function setActive(active) {
  state.mapPaintActive = active;
  document.body.classList.toggle('map-painting', active);
  el('mapPencilButton')?.setAttribute('aria-pressed', String(active));
  state.map?.dragging?.[active ? 'disable' : 'enable']();
  if (!active) drawing = false;
}

export function initMapPaint() {
  const button = el('mapPencilButton');
  const container = state.map?.getContainer?.();
  if (!button || !container) return;
  state.mapPaintLayer = L.layerGroup().addTo(state.map);
  button.addEventListener('click', () => {
    setActive(!state.mapPaintActive);
    toast(state.mapPaintActive ? 'Draw on the map with a finger or pointer. Tap Draw again when finished.' : 'Map sketch finished.');
  });
  button.addEventListener('dblclick', (event) => {
    event.preventDefault();
    state.mapPaintLayer.clearLayers();
    toast('Map sketch cleared.');
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
  const finish = (event) => {
    if (!drawing) return;
    drawing = false;
    container.releasePointerCapture?.(event.pointerId);
    activeLine = null;
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);
}

