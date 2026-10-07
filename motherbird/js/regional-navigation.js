import { CITIES } from './constants.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';

let catalog = null;
let activeId = null;

export function officialLinksForRegion(catalogue, regionId) {
  const links = catalogue?.outlinks?.[regionId];
  return Array.isArray(links)
    ? links.filter((link) => link && typeof link.label === 'string' && /^https:\/\//.test(String(link.href || '')))
    : [];
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
  const menu = document.getElementById('regionalNavigationMenu');
  const input = document.getElementById('mapSearchInput');
  if (!control || !menu) return;
  const label = region.name || id || 'Choose region';
  control.textContent = `${label} ▾`;
  control.setAttribute('aria-label', `Current map area: ${label}. Open official area pages`);
  if (input && !input.value.trim()) input.placeholder = 'Search';
  const links = officialLinksForRegion(catalog, id);
  menu.innerHTML = `<strong>Official pages for ${escapeHtml(label)}</strong>${links.length ? `<div class="regional-outlinks">${links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)} <span aria-hidden="true">↗</span></a>`).join('')}</div>` : '<p class="regional-outlinks-empty">Official pages will appear here when verified.</p>'}`;
}

export function initRegionalNavigation() {
  const control = document.getElementById('regionalNavigation');
  const menu = document.getElementById('regionalNavigationMenu');
  control?.addEventListener('click', () => { renderRegionalNavigation(); menu?.classList.toggle('hidden'); });
  window.addEventListener('viewport-region-changed', ({ detail }) => { activeId = detail?.regionId || state.activeCity; renderRegionalNavigation(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.regional-navigation')) menu?.classList.add('hidden'); });
  void loadRegionalNavigation();
}
