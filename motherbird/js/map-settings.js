import db from './storage.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { BASEMAP_PRESETS, applyMapCustomization, setOnlineBasemap } from './map.js';
import { installedStylePaint } from './offline-map-style.js';

const MAP_CUSTOMIZATION_KEY = 'motherbird.map-customization';
const BASEMAP_KEY = 'motherbird.basemap';
const STYLE_FORMAT = 'walk-wildlife-map-style-v1';
const HEX = /^#[0-9a-f]{6}$/i;
const modeLabels = { notice: 'Notice', guide: 'Guide', wander: 'Wander', remember: 'Remember' };

const STYLE_PRESETS = Object.freeze([
  { id: 'paper', name: 'Paper', kind: 'preset', description: 'Warm ink, quiet water, and a readable route.', appearance: { surface: '#f4ecd9', land: '#e8ddc4', park: '#cdddb8', water: '#b8d7df', building: '#e7d7be', road: '#a9845d', casing: '#fff8e7', marker: '#8f5a3c', outline: '#fff8e7' }, features: { plannedRoute: '#8f5a3c', recordedRoute: '#654c3b', discoveryRoute: '#48778a', annotation: '#76558b', routeWidth: 6, routeOpacity: 0.92, markerScale: 1 } },
  { id: 'field', name: 'Field', kind: 'preset', description: 'The balanced field-note palette for everyday walks.', appearance: { surface: '#edf1e4', land: '#e1ead6', park: '#cde0b9', water: '#a9d0df', building: '#e4d8c4', road: '#b39f7d', casing: '#f7f3ea', marker: '#2d7259', outline: '#ffffff' }, features: { plannedRoute: '#2d7259', recordedRoute: '#245448', discoveryRoute: '#0d5570', annotation: '#76558b', routeWidth: 6, routeOpacity: 0.88, markerScale: 1 } },
  { id: 'quiet', name: 'Quiet', kind: 'preset', description: 'Low-noise colors with discoveries kept distinct.', appearance: { surface: '#eef0eb', land: '#e5e7e0', park: '#d7e0d1', water: '#cbdde0', building: '#dedfd9', road: '#9aa39b', casing: '#f8f9f5', marker: '#5e766a', outline: '#f8f9f5' }, features: { plannedRoute: '#5e766a', recordedRoute: '#496054', discoveryRoute: '#567e8c', annotation: '#7b6d89', routeWidth: 5, routeOpacity: 0.78, markerScale: 0.94 } },
  { id: 'night', name: 'Night', kind: 'preset', description: 'Dark map surfaces with bright, calm route contrast.', appearance: { surface: '#17252d', land: '#26383a', park: '#2d4d41', water: '#193b4b', building: '#3c4646', road: '#b9c8b7', casing: '#111d23', marker: '#82c6a0', outline: '#d8eadb' }, features: { plannedRoute: '#9fe0b2', recordedRoute: '#8cc9b5', discoveryRoute: '#75c6d4', annotation: '#c0a7d3', routeWidth: 6, routeOpacity: 0.96, markerScale: 1.04 } },
  { id: 'high-contrast', name: 'High Contrast', kind: 'preset', description: 'Strong edges and clear route separation.', appearance: { surface: '#ffffff', land: '#ffffff', park: '#d7f0c4', water: '#bce8f3', building: '#eeeeee', road: '#111111', casing: '#ffffff', marker: '#111111', outline: '#ffffff' }, features: { plannedRoute: '#0057b8', recordedRoute: '#111111', discoveryRoute: '#8a1c1c', annotation: '#5b2a86', routeWidth: 7, routeOpacity: 1, markerScale: 1.06 } }
]);

const DEFAULT_MAP_SETTINGS = Object.freeze({ version: 2, activeStyleId: 'field', companionMode: 'notice', layers: Object.freeze({ personalPlaces: false, savedRoutes: true, drawings: true }), styles: [] });

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function preset(id) { return STYLE_PRESETS.find((item) => item.id === id) || STYLE_PRESETS.find((item) => item.id === 'field'); }
function styleList(saved = []) { return [...STYLE_PRESETS.map(copy), ...(Array.isArray(saved) ? saved.map(copy) : [])]; }

function migrateModel() {
  const saved = state.settings.mapSettings && typeof state.settings.mapSettings === 'object' ? state.settings.mapSettings : {};
  const styles = styleList(saved.styles);
  const activeStyleId = styles.some((item) => item.id === saved.activeStyleId) ? saved.activeStyleId : 'field';
  const next = { ...DEFAULT_MAP_SETTINGS, ...saved, version: 2, activeStyleId, companionMode: modeLabels[saved.companionMode] ? saved.companionMode : 'notice', layers: { ...DEFAULT_MAP_SETTINGS.layers, ...(saved.layers || {}) }, styles: styles.filter((item, index, all) => item?.id && all.findIndex((candidate) => candidate.id === item.id) === index) };
  state.settings.mapSettings = next;
  return next;
}

function model() { return migrateModel(); }
function currentStyle() { const settings = model(); return settings.styles.find((item) => item.id === settings.activeStyleId) || preset('field'); }

async function persist(next = model()) {
  state.settings.mapSettings = next;
  await db.put('settings', state.settings);
  applyStyle(currentStyle());
  renderStyles();
  updateSummary();
}

function legacyCustomization() {
  try { const saved = JSON.parse(localStorage.getItem(MAP_CUSTOMIZATION_KEY) || '{}'); return { tone: saved.tone || 'natural', showPlaces: saved.showPlaces !== false, showRoutes: saved.showRoutes !== false, markerOutline: saved.markerOutline || 'light' }; }
  catch { return { tone: 'natural', showPlaces: true, showRoutes: true, markerOutline: 'light' }; }
}

function visibleLayers() { const settings = model(); return { ...settings.layers, personalPlaces: state.layerLights?.personal === true, savedRoutes: state.layerFilters?.public?.__routes !== false }; }

function updateSummary() {
  const target = document.getElementById('mapSettingsSummary'); if (!target) return;
  const map = legacyCustomization(); const layers = visibleLayers(); const style = currentStyle(); const encounters = state.settings.enableGeofencing !== false ? `Encounters within ${state.settings.defaultGeofenceRadiusMeters || 50}m` : 'Encounters quiet';
  target.textContent = `${style.name} · ${BASEMAP_PRESETS[state.onlineBasemapId]?.label?.split(' · ')[0] || 'Street'} · ${layers.personalPlaces ? 'Personal places on' : 'Personal places off'} · ${map.showPlaces ? 'Places on' : 'Places off'} · ${encounters}`;
  const live = document.getElementById('mapStudioLiveStatus'); if (live) live.textContent = state.installedBasemapMap ? 'Live preview · vector appearance controls are active for this installed map.' : 'Live preview · route, marker, annotation, and map-surface changes apply now. Road, water, park, and land colors activate on an installed vector map.';
}

function setCssVariables(style) {
  const root = document.documentElement;
  Object.entries({ '--map-style-surface': style.appearance.surface, '--map-style-land': style.appearance.land, '--map-style-park': style.appearance.park, '--map-style-water': style.appearance.water, '--map-style-building': style.appearance.building, '--map-style-road': style.appearance.road, '--map-style-casing': style.appearance.casing, '--map-style-marker': style.appearance.marker, '--map-style-outline': style.appearance.outline, '--map-style-marker-scale': style.features.markerScale }).forEach(([key, value]) => root.style.setProperty(key, value));
  document.body.dataset.mapStyle = style.id;
  globalThis.__MOTHERBIRD_MAP_STYLE__ = style;
  document.getElementById('map')?.style.setProperty('background', style.appearance.surface);
}

function setLeafletStyle(layer, style, role = '') {
  if (!layer?.setStyle) return;
  const options = layer.options || {}; const styleRole = role || options.styleRole || (options.dashArray ? 'discoveryRoute' : 'annotation'); const colors = style.features;
  const color = styleRole === 'plannedRoute' ? colors.plannedRoute : styleRole === 'recordedRoute' ? colors.recordedRoute : styleRole === 'discoveryRoute' ? colors.discoveryRoute : styleRole === 'trail' ? style.appearance.road : colors.annotation;
  layer.setStyle({ color, opacity: colors.routeOpacity, weight: styleRole === 'annotation' ? 4 : colors.routeWidth, fillColor: styleRole === 'annotation' ? colors.annotation : undefined });
}

function styleLayerGroup(group, style) { group?.eachLayer?.((layer) => setLeafletStyle(layer, style)); }

function applyVectorMap(map, style) {
  if (!map || !map.isStyleLoaded?.()) return;
  Object.entries(installedStylePaint(style)).forEach(([layerId, properties]) => Object.entries(properties).forEach(([property, value]) => { try { if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value); } catch { /* regional styles may omit a layer */ } }));
}

export function applyStyle(style = currentStyle()) {
  setCssVariables(style); styleLayerGroup(state.trailLayer, style); styleLayerGroup(state.routeLightLayer, style); styleLayerGroup(state.mapPaintLayer, style); setLeafletStyle(state.routeLine, style, 'recordedRoute');
  (state.plannedRouteLines || []).forEach((line) => setLeafletStyle(line, style, 'plannedRoute')); (state.plannerRouteCasingLines || []).forEach((line) => line.setStyle?.({ color: style.appearance.casing, opacity: style.features.routeOpacity, weight: style.features.routeWidth + 5 }));
  applyVectorMap(state.installedBasemapMap, style); applyVectorMap(state.fieldEditionMap, style); window.dispatchEvent(new CustomEvent('map-style-applied', { detail: { style } }));
}

function safeStyle(input) {
  if (!input || input.format !== STYLE_FORMAT || !input.style || typeof input.style !== 'object') throw new Error('This is not a supported Walk & Wildlife style export.');
  const style = copy(input.style); const allowedAppearance = ['surface', 'land', 'park', 'water', 'building', 'road', 'casing', 'marker', 'outline']; const allowedFeatures = ['plannedRoute', 'recordedRoute', 'discoveryRoute', 'annotation', 'routeWidth', 'routeOpacity', 'markerScale'];
  if (Object.keys(style.appearance || {}).some((key) => !allowedAppearance.includes(key)) || Object.keys(style.features || {}).some((key) => !allowedFeatures.includes(key))) throw new Error('The style contains unsupported properties.');
  if (!style.name || style.name.length > 80 || !style.appearance || !style.features || !allowedAppearance.every((key) => HEX.test(style.appearance[key])) || !['plannedRoute', 'recordedRoute', 'discoveryRoute', 'annotation'].every((key) => HEX.test(style.features[key])) || style.features.routeWidth < 2 || style.features.routeWidth > 14 || style.features.routeOpacity < 0.2 || style.features.routeOpacity > 1 || style.features.markerScale < 0.75 || style.features.markerScale > 1.4) throw new Error('The style has invalid colors or ranges.');
  return { ...preset('field'), ...style, id: `custom:${Date.now()}`, kind: 'custom', version: 1 };
}

function exportStyle() { const style = currentStyle(); const blob = new Blob([JSON.stringify({ format: STYLE_FORMAT, exportedAt: new Date().toISOString(), style }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${style.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'map-style'}.walkstyle`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); toast('Style exported.'); }

async function importStyle(file) { if (!file) return; try { const imported = safeStyle(JSON.parse(await file.text())); const settings = model(); settings.styles = [...settings.styles, imported]; settings.activeStyleId = imported.id; await persist(settings); toast(`${imported.name} imported.`); } catch (error) { toast(error.message || 'That style could not be imported.'); } }

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

function renderStyles() {
  const list = document.getElementById('mapStyleCards'); if (!list) return; const settings = model();
  list.innerHTML = settings.styles.map((style) => `<button type="button" class="map-style-card ${style.id === settings.activeStyleId ? 'is-selected' : ''}" data-map-style-id="${escapeHtml(style.id)}"><span class="map-style-card-swatches" style="--swatch-surface:${style.appearance.surface};--swatch-park:${style.appearance.park};--swatch-water:${style.appearance.water};--swatch-road:${style.appearance.road}"><i></i><i></i><i></i><i></i></span><strong>${escapeHtml(style.name)}</strong><small>${escapeHtml(style.kind === 'custom' ? 'Saved locally' : style.description)}</small></button>`).join('');
  list.querySelectorAll('[data-map-style-id]').forEach((button) => button.addEventListener('click', () => { const next = model(); next.activeStyleId = button.dataset.mapStyleId; void persist(next); }));
  const selected = currentStyle(); document.getElementById('mapStyleName')?.replaceChildren(document.createTextNode(selected.name));
  ['surface', 'land', 'park', 'water', 'building', 'road', 'casing', 'boundary', 'label', 'marker', 'outline'].forEach((key) => { const input = document.getElementById(`style-${key}`); if (input) input.value = selected.appearance[key]; });
  ['plannedRoute', 'recordedRoute', 'discoveryRoute', 'annotation'].forEach((key) => { const input = document.getElementById(`style-${key}`); if (input) input.value = selected.features[key]; });
  ['routeWidth', 'routeOpacity', 'markerScale'].forEach((key) => { const input = document.getElementById(`style-${key}`); if (input) input.value = selected.features[key]; });
}

function updateCustomValue(key, value, group = 'appearance') { const settings = model(); let selected = settings.styles.find((style) => style.id === settings.activeStyleId); if (!selected) return; if (selected.kind === 'preset') { selected = { ...copy(selected), id: `custom:${Date.now()}`, name: `${selected.name} custom`, kind: 'custom' }; settings.styles.push(selected); settings.activeStyleId = selected.id; } const numericFeatureKeys = new Set(['routeWidth', 'routeOpacity', 'markerScale']); selected[group][key] = group === 'features' && numericFeatureKeys.has(key) ? Number(value) : value; void persist(settings); }
function duplicateStyle() { const settings = model(); const source = currentStyle(); const duplicate = { ...copy(source), id: `custom:${Date.now()}`, name: `${source.name} copy`, kind: 'custom' }; settings.styles.push(duplicate); settings.activeStyleId = duplicate.id; void persist(settings); toast(`${duplicate.name} saved.`); }
function saveAsStyle() { const source = currentStyle(); const name = window.prompt('Save this map style as', `${source.name} copy`); if (!name?.trim()) return; const settings = model(); const saved = { ...copy(source), id: `custom:${Date.now()}`, name: name.trim().slice(0, 80), kind: 'custom' }; settings.styles.push(saved); settings.activeStyleId = saved.id; void persist(settings); toast(`${saved.name} saved locally.`); }
function restoreStyle() { applyStyle(currentStyle()); toast(`${currentStyle().name} restored.`); }
function renameStyle() { const settings = model(); const selected = settings.styles.find((style) => style.id === settings.activeStyleId); if (!selected) return; const name = window.prompt('Name this local map style', selected.name); if (!name?.trim()) return; selected.name = name.trim().slice(0, 80); selected.kind = 'custom'; void persist(settings); }

function buildStudio() {
  const section = document.querySelector('.companion-settings-section'); if (!section || section.dataset.studioBuilt === 'true') return; section.dataset.studioBuilt = 'true';
  const heading = section.querySelector('.companion-section-heading'); const summary = section.querySelector('#mapSettingsSummary'); const intro = section.querySelector(':scope > p:not(.map-settings-summary)');
  const basemap = document.querySelector('label[for="basemapPicker"]'); const tone = document.querySelector('label[for="mapTonePicker"]'); const outline = document.querySelector('label[for="mapMarkerOutline"]'); const mode = document.querySelector('label[for="companionModePicker"]');
  const groups = [...section.querySelectorAll('.map-settings-group')]; const layers = groups.find((node) => !node.classList.contains('explore-geofence-controls')); const behavior = groups.find((node) => node.classList.contains('explore-geofence-controls'));
  const studio = document.createElement('div'); studio.className = 'map-settings-studio';
  studio.innerHTML = `<section class="map-studio-preview"><span class="sheet-kicker">LIVE PREVIEW</span><strong id="mapStyleName">Field</strong><p id="mapStudioLiveStatus">Changes apply immediately to the map.</p><div class="map-style-preview-swatch" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><button type="button" class="secondary-button" id="focusLiveMapButton">See live map</button></section><details class="map-studio-section" open><summary>Appearance</summary><p class="map-studio-help">Appearance changes rendering. Raster basemaps keep their source colors; vector paint controls activate on installed PMTiles maps.</p><div class="map-studio-fields" data-studio-appearance></div><details class="map-studio-advanced"><summary>Advanced supported styling</summary><div class="map-studio-color-grid" data-studio-colors></div></details></details><details class="map-studio-section"><summary>Layers</summary><p class="map-studio-help">Layers change what information is visible, not how the basemap is painted.</p><div data-studio-layers></div></details><details class="map-studio-section"><summary>Behavior</summary><p class="map-studio-help">Behavior changes how the Companion responds while you walk.</p><div data-studio-behavior></div></details><details class="map-studio-section"><summary>My styles</summary><p class="map-studio-help">Saved styles stay local to this device and never include journal content.</p><div class="map-style-cards" id="mapStyleCards"></div><div class="map-style-actions"><button type="button" class="secondary-button" id="saveMapStyleButton">Save as</button><button type="button" class="secondary-button" id="duplicateMapStyleButton">Duplicate</button><button type="button" class="secondary-button" id="restoreMapStyleButton">Restore</button><button type="button" class="secondary-button" id="renameMapStyleButton">Rename</button><button type="button" class="secondary-button" id="exportMapStyleButton">Export</button><label class="secondary-button map-style-import">Import<input id="importMapStyleInput" type="file" accept=".walkstyle,application/json" /></label></div></details>`;
  section.replaceChildren(heading, intro, summary, studio); studio.querySelector('[data-studio-appearance]').append(basemap, tone, outline, document.getElementById('basemapPickerStatus')); studio.querySelector('[data-studio-layers]').append(layers); studio.querySelector('[data-studio-behavior]').append(mode, behavior);
  const colors = studio.querySelector('[data-studio-colors]'); const colorFields = [['surface', 'Map surface'], ['land', 'Land'], ['park', 'Parks'], ['water', 'Water'], ['building', 'Buildings'], ['road', 'Roads'], ['casing', 'Road casing'], ['marker', 'Markers'], ['outline', 'Marker outline'], ['plannedRoute', 'Planned route'], ['recordedRoute', 'Recorded walk'], ['discoveryRoute', 'Discovery route'], ['annotation', 'Annotations']];
  colors.innerHTML = colorFields.map(([id, label]) => `<label class="map-style-color-field">${label}<input id="style-${id}" type="color" value="#173c35" /></label>`).join('') + `<label class="map-style-range-field">Route width <input id="style-routeWidth" type="range" min="2" max="14" step="1" value="6" /></label><label class="map-style-range-field">Route opacity <input id="style-routeOpacity" type="range" min=".2" max="1" step=".05" value=".9" /></label><label class="map-style-range-field">Marker size <input id="style-markerScale" type="range" min=".75" max="1.4" step=".05" value="1" /></label>`;
  const featureColorKeys = new Set(['plannedRoute', 'recordedRoute', 'discoveryRoute', 'annotation']);
  studio.querySelectorAll('input[type="color"]').forEach((input) => input.addEventListener('input', () => { const key = input.id.replace('style-', ''); updateCustomValue(key, input.value, featureColorKeys.has(key) ? 'features' : 'appearance'); }));
  ['routeWidth', 'routeOpacity', 'markerScale'].forEach((key) => document.getElementById(`style-${key}`)?.addEventListener('input', (event) => updateCustomValue(key, event.target.value, 'features')));
  document.getElementById('focusLiveMapButton')?.addEventListener('click', () => document.querySelector('[data-close-sheet]')?.click()); document.getElementById('saveMapStyleButton')?.addEventListener('click', saveAsStyle); document.getElementById('duplicateMapStyleButton')?.addEventListener('click', duplicateStyle); document.getElementById('restoreMapStyleButton')?.addEventListener('click', restoreStyle); document.getElementById('renameMapStyleButton')?.addEventListener('click', renameStyle); document.getElementById('exportMapStyleButton')?.addEventListener('click', exportStyle); document.getElementById('importMapStyleInput')?.addEventListener('change', (event) => void importStyle(event.target.files?.[0]));
}

async function setPersonalPlaces(checked) { const button = document.getElementById('personalPlacesVisibility'); if (Boolean(state.layerLights?.personal) !== checked && button) button.click(); const next = model(); next.layers.personalPlaces = checked; await persist(next); }
async function setSavedRoutes(checked) { state.layerFilters.public.__routes = checked; state.layerLights.recreation = checked || state.layerLights.recreation; window.dispatchEvent(new CustomEvent('layer-state-dirty')); const next = model(); next.layers.savedRoutes = checked; await persist(next); }
function setDrawings(checked) { const next = model(); next.layers.drawings = checked; void persist(next); window.dispatchEvent(new CustomEvent('map-drawings-visibility-requested', { detail: { visible: checked } })); }

async function resetMapSettings() {
  try { localStorage.removeItem(MAP_CUSTOMIZATION_KEY); localStorage.removeItem(BASEMAP_KEY); } catch { /* local storage is optional */ }
  applyMapCustomization(); setOnlineBasemap('street', { announce: false }); state.settings.enableGeofencing = true; state.settings.defaultGeofenceRadiusMeters = 50; state.settings.geofenceCategories = ['news', 'recreation', 'cuisine'];
  const next = model(); next.activeStyleId = 'field'; next.companionMode = 'notice'; next.layers = { personalPlaces: false, savedRoutes: true, drawings: true }; state.settings.mapSettings = next; const routesWereHidden = state.layerFilters.public.__routes === false; state.layerFilters.public.__routes = true; if (routesWereHidden) window.dispatchEvent(new CustomEvent('layer-state-dirty')); window.dispatchEvent(new CustomEvent('map-drawings-visibility-requested', { detail: { visible: true } })); await db.put('settings', state.settings); applyStyle(currentStyle());
  const geofence = document.getElementById('geofenceToggle'); if (geofence) geofence.checked = true; const radius = document.getElementById('geofenceRadiusSelect'); if (radius) radius.value = '50'; syncControls(); toast('Map settings reset. Saved routes, places, annotations, and journal data stayed safe.');
}

function syncControls() { const legacy = legacyCustomization(); const settings = model(); const basemap = document.getElementById('basemapPicker'); if (basemap) basemap.value = state.onlineBasemapId || 'street'; const tone = document.getElementById('mapTonePicker'); if (tone) tone.value = legacy.tone; const outline = document.getElementById('mapMarkerOutline'); if (outline) outline.value = legacy.markerOutline; const mode = document.getElementById('companionModePicker'); if (mode) mode.value = settings.companionMode; const places = document.getElementById('mapPersonalPlacesToggle'); if (places) places.checked = visibleLayers().personalPlaces; const routes = document.getElementById('mapSavedRoutesToggle'); if (routes) routes.checked = visibleLayers().savedRoutes; const drawings = document.getElementById('mapDrawingsToggle'); if (drawings) drawings.checked = settings.layers.drawings !== false; renderStyles(); updateSummary(); }

export function initMapSettings() {
  migrateModel(); buildStudio(); const mode = document.getElementById('companionModePicker'); mode?.addEventListener('change', () => { const next = model(); next.companionMode = mode.value; void persist(next); }); document.getElementById('mapPersonalPlacesToggle')?.addEventListener('change', (event) => void setPersonalPlaces(event.target.checked)); document.getElementById('mapSavedRoutesToggle')?.addEventListener('change', (event) => void setSavedRoutes(event.target.checked)); document.getElementById('mapDrawingsToggle')?.addEventListener('change', (event) => setDrawings(event.target.checked)); document.getElementById('resetMapSettingsButton')?.addEventListener('click', () => void resetMapSettings());
  ['change', 'input'].forEach((eventName) => document.addEventListener(eventName, (event) => { if (event.target?.matches?.('#mapTonePicker, #mapMarkerOutline, #basemapPicker, #geofenceToggle, #geofenceRadiusSelect, #geofenceCategoryChips')) updateSummary(); })); ['layer-state-dirty', 'personal-places-changed', 'local-drawings-changed', 'map-workspace-changed', 'map-vector-renderer-ready'].forEach((eventName) => window.addEventListener(eventName, updateSummary)); window.addEventListener('map-vector-renderer-ready', () => applyStyle(currentStyle())); syncControls(); applyStyle(currentStyle());
}

export { STYLE_PRESETS };
