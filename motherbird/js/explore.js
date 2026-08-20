import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import { displayPoiName } from './poi.js';
import { renderCuratedRoutes } from './routes.js';
import { generateTimeBasedPlan } from './planner.js';
import { renderCivicEvents } from './civic.js';
import { DISCOVER_GROUPS, discoverGroupFor, publishingState, rankDiscoverPlaces } from './discovery-taxonomy.js';

let activeTab = 'routes';
let activeDiscoverGroup = '';

export function initExplore() {
  renderCuratedRoutes();
  document.querySelectorAll('[data-explore-tab]').forEach((button) => button.addEventListener('click', () => setExploreTab(button.dataset.exploreTab)));
  el('explorePlaceFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-explore-tag]');
    if (!button) return;
    const tag = button.dataset.exploreTag;
    activeDiscoverGroup = activeDiscoverGroup === tag ? '' : tag;
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
  const places = rankDiscoverPlaces(all.filter((poi) => {
    const matchesText = !query || `${poi.name || ''} ${displayPoiName(poi)}`.toLowerCase().includes(query);
    const matchesGroup = !activeDiscoverGroup || discoverGroupFor(poi).id === activeDiscoverGroup;
    return matchesText && matchesGroup && (publishingState(poi) !== 'candidate' || Boolean(query));
  })).slice(0, 24);
  el('explorePlaceFilters').innerHTML = DISCOVER_GROUPS.map((group) => `<button type="button" class="poi-chip ${activeDiscoverGroup === group.id ? 'active' : ''}" aria-pressed="${activeDiscoverGroup === group.id}" data-explore-tag="${group.id}">${group.icon} ${group.label}</button>`).join('');
  const context = places.length ? `<p class="discover-context"><strong>${places.length} relevant places in this view</strong><span>Selected for this moment from the larger regional inventory.</span></p>` : '';
  el('explorePlacesList').innerHTML = context + (places.length ? places.map((poi) => { const group = discoverGroupFor(poi); return `<button type="button" class="place-result" data-place-id="${escapeHtml(poi.id)}"><span>${group.icon}</span><span><strong>${escapeHtml(displayPoiName(poi))}</strong><small>${escapeHtml(group.label)}${publishingState(poi) === 'featured' ? ' · Curated' : ''}</small></span><b>›</b></button>`; }).join('') : '<div class="empty-state"><strong>Nothing relevant surfaced here yet.</strong>Try another experience category or a broader search.</div>');
}

export function updatePlanPreview() {
  generateTimeBasedPlan();
}
