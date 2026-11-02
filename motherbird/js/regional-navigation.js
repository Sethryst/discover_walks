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
  const links = officialLinksForRegion(catalog, id);
  const subregions = subregionsForRegion(catalog, id);
  const hasMenu = links.length > 0 || subregions.length > 0 || Boolean(state.map);
  control.classList.toggle('has-menu', hasMenu);
  control.classList.remove('ink-control');
  control.replaceChildren();
  if (hasMenu) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'regional-navigation-button';
    button.id = 'regionalNavigationButton';
    button.setAttribute('aria-label', `Open ${label} regional links`);
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `<span>${escapeHtml(label)}</span><span class="regional-navigation-chevron" aria-hidden="true">⌄</span>`;
    const menu = document.createElement('div');
    menu.className = 'regional-navigation-menu hidden';
    menu.id = 'regionalNavigationMenu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<strong>${escapeHtml(label)}</strong>`;
    const bounds = state.map?.getBounds?.();
    const hotspotUrl = bounds ? `https://www.inaturalist.org/observations?verifiable=any&mappable=any&swlat=${bounds.getSouth()}&swlng=${bounds.getWest()}&nelat=${bounds.getNorth()}&nelng=${bounds.getEast()}` : 'https://www.inaturalist.org/observations?verifiable=any&mappable=any';
    menu.insertAdjacentHTML('beforeend', `<div class="regional-outlinks"><strong>Birding & nature</strong><a role="menuitem" href="${hotspotUrl}" target="_blank" rel="noopener">Explore hotspots on iNaturalist</a></div>`);
    if (subregions.length) {
      menu.insertAdjacentHTML('beforeend', `<div class="regional-region-list"><strong>Related areas</strong>${subregions.map((item) => `<a role="menuitem" href="${escapeHtml(item.href || '#')}">${escapeHtml(item.label)}</a>`).join('')}</div>`);
    }
    if (links.length) {
      menu.insertAdjacentHTML('beforeend', `<div class="regional-outlinks"><strong>Official local sites</strong>${links.map((link) => `<a role="menuitem" href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`).join('')}</div>`);
    }
    control.append(button, menu);
    button.addEventListener('click', () => {
      const open = menu.classList.toggle('hidden');
      button.setAttribute('aria-expanded', String(!open));
    });
  } else {
    const text = document.createElement('span');
    text.className = 'regional-navigation-label';
    text.textContent = label;
    text.setAttribute('aria-label', `Current map area: ${label}`);
    control.append(text);
  }
  if (input && !input.value.trim()) input.placeholder = 'Search';
}

export function initRegionalNavigation() {
  if (initialized) return;
  initialized = true;
  const control = document.getElementById('regionalNavigation');
  window.addEventListener('viewport-region-changed', ({ detail }) => { activeId = detail?.regionId || state.activeCity; renderRegionalNavigation(); });
  const refreshFromViewport = () => renderRegionalNavigation();
  state.map?.on?.('moveend', refreshFromViewport);
  void loadRegionalNavigation();
}
