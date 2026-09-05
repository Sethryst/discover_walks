import { state } from './state.js';
import { CITIES } from './constants.js';
import db from './storage.js';
import { el } from './utils.js';
import { toast } from './ui.js';

export function installedPackBounds() {
  const metadata = state.regionAutomation?.metadata;
  const raw = metadata?.boundary?.bbox || metadata?.geographicBounds;
  if (raw) return Array.isArray(raw) ? { west: raw[0], south: raw[1], east: raw[2], north: raw[3] } : raw;
  const points = state.regionAutomation?.pois || [];
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!valid.length) return null;
  return { west: Math.min(...valid.map((p) => p.lng)), east: Math.max(...valid.map((p) => p.lng)), south: Math.min(...valid.map((p) => p.lat)), north: Math.max(...valid.map((p) => p.lat)) };
}
export function validateViewConditions(value) {
  if (!value || typeof value.pack_id !== 'string' || !Number.isFinite(value.zoom) || value.zoom < 0 || value.zoom > 22 || !value.layers || !value.range) throw new Error('Invalid offline view conditions.');
  if (!/^[a-z0-9-]+$/i.test(value.pack_id) || typeof value.layers !== 'object' || Array.isArray(value.layers)) throw new Error('Invalid offline layers or pack id.');
  for (const key of ['lights', 'public', 'personal']) {
    const entries = value.layers[key];
    if (entries != null && (typeof entries !== 'object' || Array.isArray(entries) || Object.values(entries).some((on) => typeof on !== 'boolean'))) throw new Error('Offline layers must contain on/off selections.');
  }
  const range = value.range;
  if (range.type === 'radius') {
    if (!Number.isFinite(range.center?.lat) || Math.abs(range.center.lat) > 90 || !Number.isFinite(range.center?.lng) || Math.abs(range.center.lng) > 180 || !Number.isFinite(range.meters) || range.meters <= 0) throw new Error('Invalid offline radius.');
  } else if (range.type === 'bbox') {
    const b = range.bbox;
    if (!b || !['west','south','east','north'].every((key) => Number.isFinite(b[key])) || b.west >= b.east || b.south >= b.north || b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90) throw new Error('Invalid offline bounds.');
  } else throw new Error('Unknown offline range.');
  return { pack_id: value.pack_id, zoom: value.zoom, range, layers: value.layers };
}
export async function applyOfflineBootConditions() {
  if (globalThis.navigator?.onLine !== false || !state.settings.viewConditions) return;
  let view;
  try { view = validateViewConditions(state.settings.viewConditions); }
  catch { return; } // A stale imported setting must never prevent the map from rendering.
  const installed = (await db.all('regions')).filter((r) => r.status === 'installed');
  if (!installed.some((r) => r.id === view.pack_id)) return;
  const cityId = Object.entries(CITIES).find(([id, config]) => id === view.pack_id || config.packId === view.pack_id || JSON.stringify(config).includes(`./regions/${view.pack_id}/`))?.[0];
  if (!cityId) return;
  state.activeCity = cityId;
  state.settings.activeCity = cityId;
  state.offlineView = view;
  state.layerLights = { ...state.layerLights, ...view.layers.lights };
  state.layerFilters = { public: { ...view.layers.public }, personal: { ...view.layers.personal } };
}
let previewMap = null;
export function closeOfflinePreview() {
  previewMap?.remove(); previewMap = null;
  el('offlineModePreview')?.classList.add('hidden');
}
export function openOfflinePreview() {
  el('offlineModePreview').classList.remove('hidden');
  const zoom = state.map.getZoom();
  el('offlineZoomInput').value = String(zoom);
  const names = Object.entries(state.layerLights || {}).filter(([,on]) => on).map(([name]) => name === 'personal' ? 'MY PLACES' : name.toUpperCase());
  const svgNames = [...document.querySelectorAll('#map svg path')].length;
  el('offlineLayerNames').textContent = `Visible layers: ${names.join(', ') || 'none'} · ${svgNames} SVG lines/shapes`;
  const target = el('offlineTilePreview'); previewMap?.remove(); previewMap = null; target.replaceChildren();
  if (state.installedBasemapMap && globalThis.maplibregl) {
    previewMap = new maplibregl.Map({ container: target, style: state.installedBasemapMap.getStyle(), center: state.installedBasemapMap.getCenter(), zoom: Math.max(0, zoom - 1), interactive: false, attributionControl: false });
  } else target.textContent = 'No installed PMTiles preview. Saved pins and drawings still work; streets require an installed pack.';
}
export async function saveOfflineView() {
  const packId = state.regionAutomation?.activeRegionId;
  if (!packId) { toast('Install this area before saving its offline view.'); return; }
  const center = state.currentPosition || state.lastPosition || state.map.getCenter();
  const bbox = installedPackBounds();
  const range = el('offlineRangeSelect').value === 'bbox' ? { type: 'bbox', bbox } : { type: 'radius', center: { lat: center.lat, lng: center.lng }, meters: Number(state.settings.defaultGeofenceRadiusMeters || 50) };
  state.settings.viewConditions = validateViewConditions({ pack_id: packId, zoom: Number(el('offlineZoomInput').value), range, layers: { lights: { ...state.layerLights }, public: { ...state.layerFilters.public }, personal: { ...state.layerFilters.personal } } });
  await db.put('settings', state.settings);
  closeOfflinePreview();
  toast('Offline view saved for the next sealed copy.');
}
