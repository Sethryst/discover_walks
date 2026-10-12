import db from './storage.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { BASEMAP_PRESETS, applyMapCustomization, setOnlineBasemap } from './map.js';

export const DEFAULT_MAP_SETTINGS = Object.freeze({
  version: 1,
  companionMode: 'notice',
  layers: Object.freeze({ personalPlaces: false, savedRoutes: true, drawings: true })
});

const MAP_CUSTOMIZATION_KEY = 'motherbird.map-customization';
const BASEMAP_KEY = 'motherbird.basemap';
const modeLabels = { notice: 'Notice', guide: 'Guide', wander: 'Wander', remember: 'Remember' };

function model() {
  const saved = state.settings.mapSettings || {};
  return {
    ...DEFAULT_MAP_SETTINGS,
    ...saved,
    layers: { ...DEFAULT_MAP_SETTINGS.layers, ...(saved.layers || {}) },
    companionMode: modeLabels[saved.companionMode] ? saved.companionMode : DEFAULT_MAP_SETTINGS.companionMode
  };
}

async function saveModel(next) {
  state.settings.mapSettings = next;
  await db.put('settings', state.settings);
  updateSummary();
}

function customization() {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_CUSTOMIZATION_KEY) || '{}');
    return { tone: saved.tone || 'natural', showPlaces: saved.showPlaces !== false, showRoutes: saved.showRoutes !== false };
  } catch { return { tone: 'natural', showPlaces: true, showRoutes: true }; }
}

function visibleLayers() {
  const settings = model();
  return {
    ...settings.layers,
    personalPlaces: state.layerLights?.personal === true,
    savedRoutes: state.layerFilters?.public?.__routes !== false
  };
}

function updateSummary() {
  const target = document.getElementById('mapSettingsSummary');
  if (!target) return;
  const map = customization();
  const mode = modeLabels[model().companionMode];
  const layers = visibleLayers();
  const encounters = state.settings.enableGeofencing !== false ? `Encounters within ${state.settings.defaultGeofenceRadiusMeters || 50}m` : 'Encounters quiet';
  const style = BASEMAP_PRESETS[state.onlineBasemapId]?.label?.split(' · ')[0] || 'Street';
  const tone = map.tone === 'natural' ? 'Natural' : map.tone.replace('-', ' ');
  target.textContent = `${mode} map · ${style} · ${tone} · ${map.showPlaces ? 'Places on' : 'Places off'} · ${layers.personalPlaces ? 'Personal places on' : 'Personal places off'} · ${encounters}`;
}

function syncControls() {
  const map = customization();
  const settings = model();
  const basemap = document.getElementById('basemapPicker');
  if (basemap) basemap.value = state.onlineBasemapId || 'street';
  const tone = document.getElementById('mapTonePicker');
  if (tone) tone.value = map.tone;
  const outline = document.getElementById('mapMarkerOutline');
  if (outline) outline.value = (() => { try { return JSON.parse(localStorage.getItem(MAP_CUSTOMIZATION_KEY) || '{}').markerOutline || 'light'; } catch { return 'light'; } })();
  const mode = document.getElementById('companionModePicker');
  if (mode) mode.value = settings.companionMode;
  const places = document.getElementById('mapPersonalPlacesToggle');
  if (places) places.checked = visibleLayers().personalPlaces;
  const routes = document.getElementById('mapSavedRoutesToggle');
  if (routes) routes.checked = visibleLayers().savedRoutes;
  const drawings = document.getElementById('mapDrawingsToggle');
  if (drawings) drawings.checked = settings.layers.drawings !== false;
  updateSummary();
}

async function setPersonalPlaces(checked) {
  const button = document.getElementById('personalPlacesVisibility');
  if (Boolean(state.layerLights?.personal) !== checked && button) button.click();
  const next = model();
  next.layers.personalPlaces = checked;
  await saveModel(next);
}

async function setSavedRoutes(checked) {
  state.layerFilters.public.__routes = checked;
  state.layerLights.recreation = checked || state.layerLights.recreation;
  window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  const next = model();
  next.layers.savedRoutes = checked;
  await saveModel(next);
}

function setDrawings(checked) {
  const next = model();
  next.layers.drawings = checked;
  void saveModel(next);
  window.dispatchEvent(new CustomEvent('map-drawings-visibility-requested', { detail: { visible: checked } }));
}

async function resetMapSettings() {
  try { localStorage.removeItem(MAP_CUSTOMIZATION_KEY); localStorage.removeItem(BASEMAP_KEY); } catch { /* local storage is optional */ }
  applyMapCustomization();
  setOnlineBasemap('street', { announce: false });
  state.settings.enableGeofencing = true;
  state.settings.defaultGeofenceRadiusMeters = 50;
  state.settings.geofenceCategories = ['news', 'recreation', 'cuisine'];
  state.settings.mapSettings = { ...DEFAULT_MAP_SETTINGS, layers: { ...DEFAULT_MAP_SETTINGS.layers } };
  const routesWereHidden = state.layerFilters.public.__routes === false;
  state.layerFilters.public.__routes = true;
  if (routesWereHidden) window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  await db.put('settings', state.settings);
  syncControls();
  document.getElementById('geofenceToggle')?.setAttribute('checked', '');
  const geofence = document.getElementById('geofenceToggle');
  if (geofence) geofence.checked = true;
  const radius = document.getElementById('geofenceRadiusSelect');
  if (radius) radius.value = '50';
  toast('Map settings reset on this device.');
}

export function initMapSettings() {
  if (!state.settings.mapSettings) state.settings.mapSettings = { ...DEFAULT_MAP_SETTINGS, layers: { ...DEFAULT_MAP_SETTINGS.layers } };
  const mode = document.getElementById('companionModePicker');
  mode?.addEventListener('change', () => { const next = model(); next.companionMode = mode.value; void saveModel(next); });
  document.getElementById('mapPersonalPlacesToggle')?.addEventListener('change', (event) => void setPersonalPlaces(event.target.checked));
  document.getElementById('mapSavedRoutesToggle')?.addEventListener('change', (event) => void setSavedRoutes(event.target.checked));
  document.getElementById('mapDrawingsToggle')?.addEventListener('change', (event) => setDrawings(event.target.checked));
  document.getElementById('resetMapSettingsButton')?.addEventListener('click', () => void resetMapSettings());
  ['change', 'input'].forEach((eventName) => document.addEventListener(eventName, (event) => {
    if (event.target?.matches?.('#mapTonePicker, #mapMarkerOutline, #basemapPicker, #geofenceToggle, #geofenceRadiusSelect, #geofenceCategoryChips')) updateSummary();
  }));
  ['layer-state-dirty', 'personal-places-changed', 'local-drawings-changed', 'map-workspace-changed'].forEach((eventName) => window.addEventListener(eventName, updateSummary));
  syncControls();
}

