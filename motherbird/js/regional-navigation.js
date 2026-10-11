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
  const menu = document.getElementById('regionalNavigationMenu');
  const input = document.getElementById('mapSearchInput');
  if (!control || !menu) return;
  const label = region.name || id || 'Choose region';
  control.textContent = `${label} ▾`;
  control.setAttribute('aria-label', `Current map area: ${label}. Open official area pages`);
  if (input && !input.value.trim()) input.placeholder = 'Search';
  const links = officialLinksForRegion(catalog, id);
  const subregions = subregionsForRegion(catalog, id);
  const renderLinks = (items) => items.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)} <span aria-hidden="true">↗</span></a>`).join('');
  const renderGroup = (subregion) => {
    const childLinks = Array.isArray(subregion.links) ? subregion.links.filter((link) => link && typeof link.label === 'string' && /^https:\/\//.test(String(link.href || ''))) : [];
    return `<section class="regional-outlinks-group"><strong>${escapeHtml(subregion.label)}</strong>${childLinks.length ? `<div class="regional-outlinks">${renderLinks(childLinks)}</div>` : '<p class="regional-outlinks-empty">Official pages will appear here when verified.</p>'}</section>`;
  };
  menu.innerHTML = `<strong>Official pages for ${escapeHtml(label)}</strong>${links.length ? `<div class="regional-outlinks">${renderLinks(links)}</div>` : '<p class="regional-outlinks-empty">Official pages will appear here when verified.</p>'}${subregions.length ? `<div class="regional-subregions"><strong>Fairfax areas</strong>${subregions.map(renderGroup).join('')}</div>` : ''}`;
}

export function initRegionalNavigation() {
  if (initialized) return;
  initialized = true;
  const control = document.getElementById('regionalNavigation');
  const menu = document.getElementById('regionalNavigationMenu');
  control?.addEventListener('click', (event) => {
    event.stopPropagation();
    renderRegionalNavigation();
    const open = menu?.classList.toggle('hidden') === false;
    control.setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('viewport-region-changed', ({ detail }) => { activeId = detail?.regionId || state.activeCity; renderRegionalNavigation(); });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.regional-navigation')) {
      menu?.classList.add('hidden');
      control?.setAttribute('aria-expanded', 'false');
    }
  });
  void loadRegionalNavigation();
}
