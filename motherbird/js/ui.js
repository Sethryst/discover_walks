import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { el, escapeHtml, formatDistance, formatDuration, shortDate } from './utils.js';
import { renderArchive } from './archive.js';
import { renderProfile } from './profile.js';
import { geofenceCategoriesForCity } from './poi.js';
import { renderCivic } from './civic.js';
import { promptForWalk, REFLECTION_PROMPTS, wordCount } from './reflection.js';
import { renderFieldGuide } from './field-guide.js';
import { applyCompanionSettings } from './companion.js';

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
  openSheet('filtersSheet');
  window.dispatchEvent(new CustomEvent('layers-sheet-opened'));
}
export function closeSheets() {
  state.modalOpen = null;
  document.body.classList.remove('journal-open', 'layers-open');
  el('modalBackdrop').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
}
export function openSheet(id) {
  state.modalOpen = id;
  document.body.classList.toggle('journal-open', id === 'journalSheet');
  document.body.classList.toggle('layers-open', id === 'filtersSheet');
  el('modalBackdrop').classList.remove('hidden');
  const sheet = el(id);
  sheet.classList.remove('hidden');
  // Large contextual companion GIFs should load only when their sheet is
  // actually opened, then remain available through the runtime media cache.
  sheet.querySelectorAll('img[data-lazy-src]').forEach((image) => {
    image.src = image.dataset.lazySrc;
    image.removeAttribute('data-lazy-src');
  });
}
export function applyStaticAppearance() {
  const appearance = { headlineTitle: 'A walk with a purpose', headlineIcon: 'walk', developerName: '', developerUrl: '', ...(state.settings.staticAppearance || {}) };
  const allowedIcons = new Set(['walk', 'tree', 'heart', 'star', 'coffee']);
  if (!allowedIcons.has(appearance.headlineIcon)) appearance.headlineIcon = 'walk';
  el('headlineTitle').textContent = appearance.headlineTitle || 'A walk with a purpose';
  el('headlineIcon').src = `./icons/${appearance.headlineIcon}.svg`;
  const credit = el('developerCredit');
  credit.classList.toggle('hidden', !appearance.developerName);
  credit.innerHTML = appearance.developerName ? `Built by ${escapeHtml(appearance.developerName)}${/^https:\/\//.test(appearance.developerUrl || '') ? ` · <a href="${escapeHtml(appearance.developerUrl)}" target="_blank" rel="noreferrer">visit ↗</a>` : ''}` : '';
  ['advancedHeadlineTitle', 'advancedHeadlineIcon', 'developerName', 'developerUrl'].forEach((id) => { if (el(id)) el(id).value = appearance[{ advancedHeadlineTitle: 'headlineTitle', advancedHeadlineIcon: 'headlineIcon', developerName: 'developerName', developerUrl: 'developerUrl' }[id]] || ''; });
  applyCompanionSettings();
}
export function openProfile() { showView('profile'); }
export function showView(view) {
  state.activeView = view;
  el('mapView').classList.toggle('hidden', view !== 'map');
  el('exploreView').classList.toggle('hidden', view !== 'explore');
  el('fieldGuideView').classList.toggle('hidden', view !== 'fieldGuide');
  el('profileView').classList.toggle('hidden', view !== 'profile');
  el('voteView').classList.toggle('hidden', view !== 'vote');
  el('volunteerView').classList.toggle('hidden', view !== 'volunteer');
  const discoverViews = new Set(['explore', 'fieldGuide', 'vote', 'volunteer']);
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view || (discoverViews.has(view) && item.dataset.view === 'explore')));
  if (view === 'profile') {
    renderProfile();
    renderArchive();
  } else if (view === 'fieldGuide') {
    renderFieldGuide();
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
  const prompt = promptForWalk(walkId || '');
  el('journalForm').reset();
  el('journalForm').dataset.walkId = walkId || '';
  el('journalForm').dataset.prompt = prompt;
  el('journalTitle').textContent = walkId ? 'Tell it back, in your own words.' : 'Hold onto this feeling.';
  el('journalPrompt').textContent = prompt;
  el('journalContext').textContent = `${new Date().toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })} · ${CITIES[state.activeCity].name} · private on this device`;
  el('journalPromptChoices').innerHTML = REFLECTION_PROMPTS.map((item) => `<button class="poi-chip ${item === prompt ? 'active' : ''}" type="button" data-journal-prompt="${escapeHtml(item)}" aria-pressed="${item === prompt}">${escapeHtml(item)}</button>`).join('');
  el('journalWordCount').textContent = `${wordCount(el('journalNote').value)} words`;
  el('journalNote').placeholder = 'Write across the lines. A sentence is enough; a whole page is welcome.';
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
