import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import { displayPoiName, isVerifiedPoi } from './poi.js';
import { renderCuratedRoutes } from './routes.js';
import { generateTimeBasedPlan } from './planner.js';
import { renderCivicEvents } from './civic.js';
import { renderPersonalPlacesPanel } from './personal-places.js';
import { DISCOVER_GROUPS, discoverGroupFor, publishingState, rankDiscoverPlaces } from './discovery-taxonomy.js';

let activeTab = 'routes';
let activeDiscoverGroup = '';

export function openDiscoverGroup(group) {
  activeDiscoverGroup = DISCOVER_GROUPS.some((item) => item.id === group) ? group : '';
  setExploreTab('places');
}

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
  ['routes', 'places', 'events', 'personal'].forEach((name) => el(`explore${name[0].toUpperCase()}${name.slice(1)}`).classList.toggle('hidden', name !== tab));
  if (tab === 'places') renderExplorePlaces();
  if (tab === 'routes') renderCuratedRoutes();
  if (tab === 'events') void renderCivicEvents();
  if (tab === 'personal') renderPersonalPlacesPanel();
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
  const context = places.length ? '<p class="discover-context"><strong>A considered selection for this moment</strong><span>Start with one that feels right; the regional map remains there when you want more.</span></p>' : '';
  const empty = activeDiscoverGroup
    ? `<div class="empty-state"><strong>${escapeHtml(DISCOVER_GROUPS.find((group) => group.id === activeDiscoverGroup)?.label || 'This experience')} is still taking shape here.</strong>There is not enough reviewed local material to recommend yet. Try another experience or search the wider map.</div>`
    : '<div class="empty-state"><strong>This local selection is still taking shape.</strong>Try an experience category or search the wider map.</div>';
  el('explorePlacesList').innerHTML = context + (places.length ? places.map((poi) => { const group = discoverGroupFor(poi); const verification = isVerifiedPoi(poi) ? ' · Verified source' : ' · Source record'; return `<button type="button" class="place-result" data-place-id="${escapeHtml(poi.id)}"><span>${group.icon}</span><span><strong>${escapeHtml(displayPoiName(poi))}</strong><small>${escapeHtml(group.label)}${publishingState(poi) === 'featured' ? ' · Curated' : ''}${verification}</small></span><b>›</b></button>`; }).join('') : empty);
}

export function updatePlanPreview() {
  generateTimeBasedPlan();
}
