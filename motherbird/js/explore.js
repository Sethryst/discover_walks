import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import { poiTags, displayPoiName } from './poi.js';
import { renderCuratedRoutes } from './routes.js';
import { generateTimeBasedPlan } from './planner.js';
import { renderCivicEvents } from './civic.js';

let activeTab = 'routes';

export function initExplore() {
  renderCuratedRoutes();
  document.querySelectorAll('[data-explore-tab]').forEach((button) => button.addEventListener('click', () => setExploreTab(button.dataset.exploreTab)));
  el('explorePlaceFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-explore-tag]');
    if (!button) return;
    const tag = button.dataset.exploreTag;
    state.poiTags.has(tag) ? state.poiTags.delete(tag) : state.poiTags.add(tag);
    renderExplorePlaces();
  });
  el('exploreSearchInput').addEventListener('input', renderExplorePlaces);
  document.querySelectorAll('.planner-chip').forEach((button) => button.addEventListener('click', () => { button.classList.toggle('active'); generateTimeBasedPlan(); }));
  document.querySelectorAll('input[name="walkTime"]').forEach((input) => input.addEventListener('change', updatePlanPreview));
  document.querySelectorAll('input[name="routeMode"]').forEach((input) => input.addEventListener('change', updatePlanPreview));
}

export function setExploreTab(tab) {
  activeTab = tab;
  document.querySelectorAll('[data-explore-tab]').forEach((button) => {
    const selected = button.dataset.exploreTab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  ['routes', 'places', 'events'].forEach((name) => el(`explore${name[0].toUpperCase()}${name.slice(1)}`).classList.toggle('hidden', name !== tab));
  if (tab === 'places') renderExplorePlaces();
  if (tab === 'routes') renderCuratedRoutes();
  if (tab === 'events') void renderCivicEvents();
}

export function renderExplorePlaces() {
  const all = state.cityPois[state.activeCity] || [];
  const query = el('exploreSearchInput').value.trim().toLowerCase();
  const tags = [...state.poiTags];
  const places = all.filter((poi) => (!query || `${poi.name || ''} ${displayPoiName(poi)}`.toLowerCase().includes(query)) && (!tags.length || tags.some((tag) => poiTags(poi).includes(tag)))).slice(0, 50);
  const available = ['park', 'trail', 'history', 'library', 'public_art', 'water_access'].filter((tag) => all.some((poi) => poiTags(poi).includes(tag)));
  el('explorePlaceFilters').innerHTML = available.map((tag) => `<button type="button" class="poi-chip ${state.poiTags.has(tag) ? 'active' : ''}" data-explore-tag="${tag}">${tag.replace('_', ' ')}</button>`).join('');
  el('explorePlacesList').innerHTML = places.length ? places.map((poi) => `<button type="button" class="place-result" data-place-id="${escapeHtml(poi.id)}"><span>${poiTags(poi).includes('history') ? '✦' : '●'}</span><span><strong>${escapeHtml(displayPoiName(poi))}</strong><small>${escapeHtml(poiTags(poi).filter((tag) => !tag.startsWith('history_'))[0] || 'place')}</small></span><b>›</b></button>`).join('') : '<div class="empty-state">No places match these filters. Try clearing a category or search.</div>';
}

export function updatePlanPreview() {
  generateTimeBasedPlan();
}
