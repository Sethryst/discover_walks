import { state } from './state.js';
import { GEOFENCE_CATEGORIES } from './constants.js';
import { el, escapeHtml, formatDistance, formatDuration, shortDate } from './utils.js';
import { renderArchive } from './archive.js';
import { renderProfile } from './profile.js';
import { geofenceCategoriesForCity, renderPoiTagFilters } from './poi.js';
import { renderCivic } from './civic.js';

export function setArchiveFilter(filter = 'all') {
  state.archiveFilter = filter;
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  renderArchive();
}

export function openAccountSettings() {
  el('accountUsernameInput').value = state.online.remoteProfile?.username || '';
  el('accountEmailInput').value = state.online.session?.user?.email || '';
  el('accountPasswordInput').value = '';
  openSheet('accountSheet');
}
export function openFiltersSheet() {
  renderPoiTagFilters();
  openSheet('filtersSheet');
}
export function closeSheets() {
  state.modalOpen = null;
  el('modalBackdrop').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
}
export function openSheet(id) { state.modalOpen = id; el('modalBackdrop').classList.remove('hidden'); el(id).classList.remove('hidden'); }
export function openProfile() { showView('profile'); }
export function showView(view) {
  state.activeView = view;
  el('mapView').classList.toggle('hidden', view !== 'map');
  el('exploreView').classList.toggle('hidden', view !== 'explore');
  el('profileView').classList.toggle('hidden', view !== 'profile');
  el('voteView').classList.toggle('hidden', view !== 'vote');
  el('volunteerView').classList.toggle('hidden', view !== 'volunteer');
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  if (view === 'profile') {
    renderProfile();
    renderArchive();
  } else if (view === 'vote' || view === 'volunteer') {
    renderCivic(view);
  } else if (view === 'map' && state.map) {
    state.map.invalidateSize();
    window.scrollTo({ top: 0, behavior: 'smooth' });
 }
}
export function renderLeaderboard() {
  const rows = state.online.leaderboard || [];
  el('leaderboardList').innerHTML = rows.length ? rows.map((person, index) => {
  return `<div class="leaderboard-row"><span class="leaderboard-rank">${index + 1}</span><div class="leaderboard-person"><strong>${escapeHtml(person.username)}${person.id === state.online.session?.user.id ? ' (you)' : ''}</strong><span>${Number(person.miles_total || 0).toFixed(1)} miles · ${person.sites_discovered || 0} sites</span></div><span class="leaderboard-points">${person.total_points || 0}</span></div>`;
}).join('') : '<div class="empty-state">Add a friend by username to begin a private leaderboard.</div>';}
export function renderIncomingRequests() {
  const section = el('incomingRequests');
  const list = state.online.incoming || [];
  section.classList.toggle('hidden', list.length === 0);
  el('incomingRequestsList').innerHTML = list.length
    ? list.map((request) => `<div class="leaderboard-row"><div class="leaderboard-person"><strong>@${escapeHtml(request.username)}</strong><span>wants to add you</span></div><button class="secondary-button" data-accept-id="${escapeHtml(request.user_id)}">Accept</button></div>`).join('')
    : '';
}
export function toast(message) { const node = el('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => node.classList.add('hidden'), 3200); }
export function setStatus() { /* Map status copy is intentionally omitted. */ }
export function openJournal(walkId = null) {
  const prompts = [
    'What did you notice today that surprised you?',
    'Describe one place you will remember.',
    'What changed between the beginning and end of this walk?',
    'What did your attention return to?'
  ];
  const index = walkId ? [...walkId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % prompts.length : 0;
  el('journalForm').reset();
  el('journalForm').dataset.walkId = walkId || '';
  el('journalTitle').textContent = walkId ? 'Tell it back, in your own words.' : 'Hold onto this feeling.';
  el('journalPrompt').textContent = walkId ? prompts[index] : 'A private note for your own return.';
  el('journalNote').placeholder = walkId ? 'Optional—your words stay on this device…' : 'A few words about where your feet and attention took you…';
  openSheet('journalSheet');
}
export function momentCard(item) {
  const kind = item.type === 'observation' ? 'observation' : item.type === 'history' ? 'history' : item.type === 'walk' ? 'walk' : 'journal';
  const icons = { observation: '⌁', history: '✦', walk: '↝', journal: '✎' };
  const title = item.species || item.title || 'Walk';
  let detail = item.note || '';
  if (item.type === 'walk') detail = `${formatDistance(item.distanceMeters)} miles · ${formatDuration(item.durationSeconds)} · +${item.pointsAwarded ?? 0} pts`;
  if (!detail) detail = item.type === 'observation' ? 'Nature observation' : 'Journal reflection';
  return `<article class="moment-card ${item.type === 'walk' ? 'walk-card' : ''}" ${item.type === 'walk' ? `data-walk-id="${escapeHtml(item.id)}" role="button" tabindex="0"` : ''}><span class="moment-symbol ${kind === 'history' ? 'history' : kind === 'walk' ? 'walk' : ''}">${icons[kind]}</span><div class="moment-copy"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div><time class="moment-date">${shortDate(item.createdAt || item.startedAt)}</time></article>`;
}
export function badge(name, earned, detail) { return `<span class="badge ${earned ? 'earned' : ''}" title="${escapeHtml(detail)}">${earned ? '✓ ' : ''}${escapeHtml(name)}</span>`; }
export function renderGeofenceCategoryChips() {
  const categories = geofenceCategoriesForCity();
  const selected = new Set(state.settings.geofenceCategories || (categories.length ? categories : GEOFENCE_CATEGORIES).map(([id]) => id));
  const chipsEl = el('geofenceCategoryChips');
  if (chipsEl) {
    chipsEl.innerHTML = categories.map(([id, label]) => `<button type="button" class="poi-chip ${selected.has(id) ? 'active' : ''}" aria-pressed="${selected.has(id)}" data-geofence-category="${id}">${label}</button>`).join('') || '<p class="sheet-intro">No local, non-OpenStreetMap place categories are available for geofencing in this region.</p>';
  }
}
