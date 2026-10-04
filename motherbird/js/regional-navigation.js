import { CITIES } from './constants.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { switchCity } from './city.js';

let catalog = null;
let activeId = null;

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
  control.setAttribute('aria-label', `Active area: ${label}. Change area`);
  if (input && !input.value.trim()) input.placeholder = 'Search';
  const links = catalog?.outlinks?.[id] || [];
  menu.innerHTML = `<strong>Explore in ${escapeHtml(label)}</strong>${links.length ? `<div class="regional-outlinks"><strong>Official pages <span aria-hidden="true">↗</span></strong>${links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)} <span aria-hidden="true">↗</span></a>`).join('')}</div>` : '<p class="regional-outlinks-empty">Official pages will appear here when verified.</p>'}`;
}

export function initRegionalNavigation() {
  const control = document.getElementById('regionalNavigation');
  const menu = document.getElementById('regionalNavigationMenu');
  control?.addEventListener('click', () => { renderRegionalNavigation(); menu?.classList.toggle('hidden'); });
  window.addEventListener('regional-navigation-change', ({ detail }) => { if (detail?.regionId) void switchCity(detail.regionId); });
  window.addEventListener('viewport-region-changed', ({ detail }) => { activeId = detail?.regionId || state.activeCity; renderRegionalNavigation(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.regional-navigation')) menu?.classList.add('hidden'); });
  void loadRegionalNavigation();
}
