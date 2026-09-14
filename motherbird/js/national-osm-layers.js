import { state } from './state.js';
import db from './storage.js';
import { NATIONAL_POI_CATEGORIES } from './national-poi-map.js';
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
    return `<section class="national-osm-layer-group" data-national-osm-group="${escapeHtml(group.id)}"><h4>${escapeHtml(group.label)} <small>(${enabled}/${categories.length} shown)</small></h4><div class="national-osm-layer-chips">${categories.map((category) => {
      const selected = settings?.[category.id] === true;
      return `<button type="button" class="national-osm-layer-chip ${selected ? 'on' : 'off'}" style="--chip-color:${escapeHtml(category.color)}" data-national-osm-layer="${escapeHtml(category.id)}" aria-pressed="${selected}">${escapeHtml(category.label)}</button>`;
    }).join('')}</div></section>`;
  }).join('');
}

export function renderNationalOsmLayerControls() {
  const root = document.getElementById('nationalOsmLayerControls');
  if (!root) return;
  root.innerHTML = nationalOsmLayerControlsHtml();
}

async function persistAndApply() {
  await db.put('layer_settings', { id: 'national-osm-layers', version: 1, categories: { ...state.nationalOsmLayers }, updatedAt: new Date().toISOString() });
  renderNationalOsmLayerControls();
  window.dispatchEvent(new CustomEvent('national-osm-layers-changed', { detail: { enabled: enabledNationalOsmLayerIds() } }));
}

function bindNationalOsmLayerControls() {
  if (bindNationalOsmLayerControls.bound) return;
  bindNationalOsmLayerControls.bound = true;
  document.addEventListener('click', (event) => {
    const layer = event.target.closest('[data-national-osm-layer]');
    if (layer) {
      const id = layer.dataset.nationalOsmLayer;
      state.nationalOsmLayers[id] = state.nationalOsmLayers[id] !== true;
      void persistAndApply();
    }
  });
}
