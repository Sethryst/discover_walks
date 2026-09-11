import { state } from './state.js';
import db from './storage.js';
import { NATIONAL_POI_CATEGORIES, nationalPoiIconUrl } from './national-poi-map.js';
import { escapeHtml } from './utils.js';

export const NATIONAL_OSM_LAYER_DEFAULTS = Object.freeze(['trail', 'nature']);
export const NATIONAL_OSM_LAYER_GROUPS = Object.freeze([
  { id: 'walking', label: 'Walking network', categoryIds: ['trail', 'walkway', 'crossing', 'barrier'] },
  { id: 'nature', label: 'Nature & water', categoryIds: ['nature', 'waterfront', 'scenic', 'recreation'] },
  { id: 'destinations', label: 'Places & services', categoryIds: ['rest', 'historic', 'civic', 'transit', 'food'] }
]);

const categoryById = new Map(NATIONAL_POI_CATEGORIES.map((category) => [category.id, category]));

export function normalizedNationalOsmLayers(saved = null) {
  const firstRun = !saved || !saved.categories || typeof saved.categories !== 'object';
  const defaults = new Set(NATIONAL_OSM_LAYER_DEFAULTS);
  return Object.fromEntries(NATIONAL_POI_CATEGORIES.map(({ id }) => [id, firstRun ? defaults.has(id) : saved.categories[id] === true]));
}

export function enabledNationalOsmLayerIds(settings = state.nationalOsmLayers) {
  return NATIONAL_POI_CATEGORIES.filter(({ id }) => settings?.[id] === true).map(({ id }) => id);
}

export function hasEnabledNationalOsmLayers(settings = state.nationalOsmLayers) {
  return enabledNationalOsmLayerIds(settings).length > 0;
}

export async function initNationalOsmLayers() {
  const saved = await db.get('layer_settings', 'national-osm-layers');
  state.nationalOsmLayers = normalizedNationalOsmLayers(saved);
  renderNationalOsmLayerControls();
  bindNationalOsmLayerControls();
}

export function nationalOsmLayerControlsHtml(settings = state.nationalOsmLayers) {
  return NATIONAL_OSM_LAYER_GROUPS.map((group) => {
    const categories = group.categoryIds.map((id) => categoryById.get(id)).filter(Boolean);
    const enabled = categories.filter(({ id }) => settings?.[id] === true).length;
    const allEnabled = enabled === categories.length;
    return `<section class="layer-filter-group national-osm-layer-group" data-national-osm-group="${escapeHtml(group.id)}"><header><div class="layer-collapse"><span>${escapeHtml(group.label)}</span><small>${enabled}/${categories.length}</small></div><label class="layer-toggle-all"><input type="checkbox" data-national-osm-toggle-all="${escapeHtml(group.id)}" ${allEnabled ? 'checked' : ''} /> Toggle all</label></header><div class="layer-options">${categories.map((category) => `<label class="layer-option" style="--layer-color:${escapeHtml(category.color)}"><input type="checkbox" data-national-osm-layer="${escapeHtml(category.id)}" ${settings?.[category.id] === true ? 'checked' : ''} /><span class="layer-icon"><img src="${escapeHtml(nationalPoiIconUrl(category))}" alt="" /></span><span class="layer-option-copy"><strong>${escapeHtml(category.label)}</strong><small>National OpenStreetMap layer</small></span></label>`).join('')}</div></section>`;
  }).join('');
}

export function renderNationalOsmLayerControls() {
  const root = document.getElementById('nationalOsmLayerControls');
  if (!root) return;
  const enabled = enabledNationalOsmLayerIds();
  root.innerHTML = `<p class="map-layer-status">${enabled.length} of ${NATIONAL_POI_CATEGORIES.length} national layers shown. Choices are stored on this device.</p>${nationalOsmLayerControlsHtml()}`;
}

async function persistAndApply() {
  await db.put('layer_settings', { id: 'national-osm-layers', version: 1, categories: { ...state.nationalOsmLayers }, updatedAt: new Date().toISOString() });
  renderNationalOsmLayerControls();
  window.dispatchEvent(new CustomEvent('national-osm-layers-changed', { detail: { enabled: enabledNationalOsmLayerIds() } }));
}

function bindNationalOsmLayerControls() {
  if (bindNationalOsmLayerControls.bound) return;
  bindNationalOsmLayerControls.bound = true;
  document.addEventListener('change', (event) => {
    const layer = event.target.closest('[data-national-osm-layer]');
    if (layer) {
      state.nationalOsmLayers[layer.dataset.nationalOsmLayer] = layer.checked;
      void persistAndApply();
      return;
    }
    const toggle = event.target.closest('[data-national-osm-toggle-all]');
    if (!toggle) return;
    const group = NATIONAL_OSM_LAYER_GROUPS.find(({ id }) => id === toggle.dataset.nationalOsmToggleAll);
    group?.categoryIds.forEach((id) => { state.nationalOsmLayers[id] = toggle.checked; });
    void persistAndApply();
  });
}
