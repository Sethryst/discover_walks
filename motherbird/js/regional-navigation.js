import { CITIES } from './constants.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';

let catalog = null;
let activeId = null;
let initialized = false;

export function officialLinksForRegion(catalogue, regionId) {
  const links = catalogue?.outlinks?.[regionId];
  return Array.isArray(links)
    ? links.filter((link) => link && typeof link.label === 'string' && /^https:\/\//.test(String(link.href || '')))
    : [];
}

export function subregionsForRegion(catalogue, regionId) {
  const subregions = catalogue?.subregions?.[regionId];
  return Array.isArray(subregions) ? subregions.filter((subregion) => subregion && typeof subregion.label === 'string') : [];
}

export async function loadRegionalNavigation() {
  catalog ||= await fetch('./data/regional-navigation.json').then((response) => response.ok ? response.json() : null).catch(() => null);
  activeId = state.activeCity || activeId;
  renderRegionalNavigation();
  return catalog;
}

function renderRegionalNavigation() {
  const id = activeId || state.activeCity;
  const region = CITIES[id] || {};
  const control = document.getElementById('regionalNavigation');
  const input = document.getElementById('mapSearchInput');
  if (!control) return;
  const label = region.name || id || 'Choose region';
  control.textContent = label;
  control.setAttribute('aria-label', `Current map area: ${label}`);
  if (input && !input.value.trim()) input.placeholder = 'Search';
}

export function initRegionalNavigation() {
  if (initialized) return;
  initialized = true;
  const control = document.getElementById('regionalNavigation');
  window.addEventListener('viewport-region-changed', ({ detail }) => { activeId = detail?.regionId || state.activeCity; renderRegionalNavigation(); });
  void loadRegionalNavigation();
}
