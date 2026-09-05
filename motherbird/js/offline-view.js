import { state } from './state.js';
import { CITIES } from './constants.js';
import db from './storage.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import { OFFLINE_MAP_PRESETS, DEFAULT_OFFLINE_PRESET, offlineMapPreset, offlinePresetSvg, installedTileStyle } from './offline-map-style.js';
import { probeInstalledTile } from './installed-tiles.js';

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
  if (value.preset != null) offlineMapPreset(value.preset);
  return { pack_id: value.pack_id, zoom: value.zoom, range, layers: value.layers, ...(value.preset != null ? { preset: value.preset } : {}) };
}
export async function applyOfflineBootConditions() {
  if (globalThis.navigator?.onLine !== false || !state.settings.viewConditions) return;
  let view;
  try { view = validateViewConditions(state.settings.viewConditions); }
  catch { return; }
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
let selectedPreset = DEFAULT_OFFLINE_PRESET;
let previewRevision = 0;
export function closeOfflinePreview() {
  previewRevision += 1;
  previewMap?.remove(); previewMap = null;
  el('offlineModePreview')?.classList.add('hidden');
}
export function openOfflinePreview() {
  el('offlineModePreview').classList.remove('hidden');
  const zoom = state.map.getZoom();
  el('offlineZoomInput').value = String(zoom);
  selectedPreset = state.settings.viewConditions?.preset || DEFAULT_OFFLINE_PRESET;
  try { offlineMapPreset(selectedPreset); } catch { selectedPreset = DEFAULT_OFFLINE_PRESET; }
  renderPresetChoices();
  el('offlineZoomInput').oninput = () => {
    const value = Number(el('offlineZoomInput').value);
    if (Number.isFinite(value) && value >= 0 && value <= 22) previewMap?.setZoom(Math.max(0, value - 1));
    el('offlineTileStatus').textContent = 'View changed. Verify the installed tile again.';
  };
  el('verifyOfflineTilesButton').onclick = () => void verifyOfflineTiles();
  const names = Object.entries(state.layerLights || {}).filter(([,on]) => on).map(([name]) => name === 'personal' ? 'MY PLACES' : name.toUpperCase());
  const svgNames = [...document.querySelectorAll('#map svg path')].length;
  el('offlineLayerNames').textContent = `Visible layers: ${names.join(', ') || 'none'} · ${svgNames} SVG lines/shapes`;
  const target = el('offlineTilePreview'); previewMap?.remove(); previewMap = null; target.replaceChildren();
  if (state.installedBasemapMap && state.installedBasemapSource && globalThis.maplibregl) {
    previewMap = new maplibregl.Map({ container: target, style: installedTileStyle(state.installedBasemapSource, selectedPreset), center: state.installedBasemapMap.getCenter(), zoom: Math.max(0, zoom - 1), interactive: false, attributionControl: false });
    previewMap.on('error', () => { el('offlineTileStatus').textContent = 'Installed map rendering failed. Do not treat the style sample as coverage.'; });
  } else target.textContent = 'No installed PMTiles preview. Saved pins and drawings still work; streets require an installed pack.';
  void verifyOfflineTiles();
}
function renderPresetChoices() {
  el('offlinePresetChoices').innerHTML = OFFLINE_MAP_PRESETS.map((preset) => `<label class="offline-preset"><input type="radio" name="offlinePreset" value="${preset.id}" ${preset.id === selectedPreset ? 'checked' : ''} />${offlinePresetSvg(preset.id)}<strong>${preset.name}</strong><small>${preset.description}</small></label>`).join('');
  el('offlinePresetChoices').onchange = (event) => {
    if (event.target.name !== 'offlinePreset') return;
    selectedPreset = offlineMapPreset(event.target.value).id;
    if (previewMap) previewMap.setStyle(installedTileStyle(state.installedBasemapSource, selectedPreset));
  };
}
async function installedViewFile() {
  const packId = state.regionAutomation?.activeRegionId;
  if (!packId || (await db.get('regions', packId))?.status !== 'installed') throw new Error('No installed pack. Install this area online first; presets do not generate streets.');
  const { regionInstaller } = await import('./region-ui.js');
  const file = await regionInstaller.opfs.readFile(`regions/${packId}/${packId}.pmtiles`);
  return { packId, file };
}
export async function verifyOfflineTiles() {
  const revision = ++previewRevision;
  el('offlineTileStatus').textContent = 'Reading a tile from on-device storage…';
  try {
    const { file } = await installedViewFile();
    const center = state.map.getCenter();
    const proof = await probeInstalledTile(file, { lat: center.lat, lng: center.lng, zoom: Number(el('offlineZoomInput').value) });
    if (revision !== previewRevision) return;
    el('offlineTileStatus').textContent = `On-device tile verified: ${proof.z}/${proof.x}/${proof.y} · ${proof.bytes.toLocaleString()} bytes · ${proof.layers.length} declared layers. No network used. This checks one tile, not full-area coverage.`;
  } catch (error) {
    if (revision === previewRevision) el('offlineTileStatus').textContent = error.message || 'Installed tiles could not be verified.';
  }
}
export async function saveOfflineView() {
  const { packId, file } = await installedViewFile();
  const center = state.map.getCenter();
  const bbox = installedPackBounds();
  const range = el('offlineRangeSelect').value === 'bbox' ? { type: 'bbox', bbox } : { type: 'radius', center: { lat: center.lat, lng: center.lng }, meters: Number(state.settings.defaultGeofenceRadiusMeters || 50) };
  const view = validateViewConditions({ pack_id: packId, preset: selectedPreset, zoom: Number(el('offlineZoomInput').value), range, layers: { lights: { ...state.layerLights }, public: { ...state.layerFilters.public }, personal: { ...state.layerFilters.personal } } });
  await probeInstalledTile(file, { lat: center.lat, lng: center.lng, zoom: view.zoom });
  state.settings.viewConditions = view;
  await db.put('settings', state.settings);
  window.dispatchEvent(new CustomEvent('offline-view-saved'));
  closeOfflinePreview();
  toast('Offline view saved for the next sealed copy.');
}
