import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { el, escapeHtml, formatDistance, formatDuration, shortDate } from './utils.js';
import { renderArchive } from './archive.js';
import { renderProfile } from './profile.js';
import { geofenceCategoriesForCity } from './poi.js';
import { renderCivic } from './civic.js';
import { wordCount } from './reflection.js';
import { renderFieldGuide } from './field-guide.js';
import { applyCompanionSettings } from './companion.js';
import { REFLECTION_PROMPTS } from './reflection.js';
import db from './storage.js';

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
export function closeSheets() {
  if (state.modalOpen === 'journalSheet') {
    window.dispatchEvent(new CustomEvent('journal-close-requested', { detail: { note: el('journalNote')?.value || '', walkId: el('journalForm')?.dataset.walkId || '' } }));
  }
  state.modalOpen = null;
  document.body.classList.remove('journal-open', 'layers-open', 'backpack-open');
  el('journalButton')?.setAttribute('aria-pressed', 'false');
  el('settingsButton')?.setAttribute('aria-pressed', 'false');
  el('modalBackdrop')?.classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
  window.dispatchEvent(new CustomEvent('map-overlay-changed', { detail: { open: false } }));
}
export function openSheet(id) {
  if (state.modalOpen === 'journalSheet' && id !== 'journalSheet') {
    window.dispatchEvent(new CustomEvent('journal-close-requested', { detail: { note: el('journalNote')?.value || '', walkId: el('journalForm')?.dataset.walkId || '' } }));
  }
  state.modalOpen = id;
  document.body.classList.toggle('journal-open', id === 'journalSheet');
  document.body.classList.toggle('backpack-open', id === 'backpackSheet');
  el('journalButton')?.setAttribute('aria-pressed', String(id === 'journalSheet'));
  el('settingsButton')?.setAttribute('aria-pressed', String(id === 'backpackSheet'));
  document.querySelectorAll('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  el('modalBackdrop')?.classList.remove('hidden');
  const sheet = el(id);
  if (!sheet) return;
  sheet.classList.remove('hidden');
  // Large contextual companion GIFs should load only when their sheet is
  // actually opened, then remain available through the runtime media cache.
  sheet.querySelectorAll('img[data-lazy-src]').forEach((image) => {
    image.src = image.dataset.lazySrc;
    image.removeAttribute('data-lazy-src');
  });
  window.dispatchEvent(new CustomEvent('map-overlay-changed', { detail: { open: true, id } }));
}
export function applyStaticAppearance() {
  applyCompanionSettings();
}
export function openProfile() { openBackpack(); }
export function showView(view) {
  state.activeView = 'map';
  el('mapView')?.classList.remove('hidden');
  if (view === 'fieldGuide') {
    openBackpack();
  } else if (state.map) {
    state.map.invalidateSize();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
export function renderLeaderboard() {
  const rows = state.online.leaderboard || [];
  if (!el('leaderboardList')) return;
  el('leaderboardList').innerHTML = rows.length ? rows.map((person, index) => {
  return `<div class="leaderboard-row"><span class="leaderboard-rank">${index + 1}</span><div class="leaderboard-person"><strong>${escapeHtml(person.username)}${person.id === state.online.session?.user.id ? ' (you)' : ''}</strong><span>${Number(person.miles_total || 0).toFixed(1)} miles · ${person.sites_discovered || 0} sites</span></div><span class="leaderboard-points">${person.total_points || 0}</span></div>`;
}).join('') : '<div class="empty-state">Add a friend by username to begin a private leaderboard.</div>';}
export function renderIncomingRequests() {
  const section = el('incomingRequests');
  if (!section || !el('incomingRequestsList')) return;
  const list = state.online.incoming || [];
  section.classList.toggle('hidden', list.length === 0);
  el('incomingRequestsList').innerHTML = list.length
    ? list.map((request) => `<div class="leaderboard-row"><div class="leaderboard-person"><strong>@${escapeHtml(request.username)}</strong><span>wants to add you</span></div><button class="secondary-button" data-accept-id="${escapeHtml(request.user_id)}">Accept</button></div>`).join('')
    : '';
}
export function toast(message) { const node = el('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => node.classList.add('hidden'), 3200); }
export function setStatus() { /* Map status copy is intentionally omitted. */ }
export async function openJournal(walkId = null) {
  if (state.modalOpen === 'journalSheet') { closeSheets(); return; }
  const form = el('journalForm');
  const previousWalkId = form.dataset.walkId || '';
  form.dataset.walkId = walkId || previousWalkId;
  const moments = await db.all('moments');
  const existing = walkId ? moments.find((item) => item.type === 'journal' && item.walkId === walkId) : null;
  if (existing) { el('journalNote').value = existing.note || ''; form.dataset.momentId = existing.id; }
  else if (walkId && walkId !== previousWalkId) { el('journalNote').value = ''; delete form.dataset.momentId; }
  const prompts = el('journalPrompts');
  prompts.innerHTML = REFLECTION_PROMPTS.map((prompt) => `<button type="button" data-reflection-prompt>${escapeHtml(prompt)}</button>`).join('');
  prompts.classList.toggle('hidden', Boolean(el('journalNote').value.trim()));
  const walks = state.walks?.length || 0;
  const notes = moments.filter((item) => item.type === 'journal').length;
  el('journalTitle').textContent = `${new Date().toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })} · ${CITIES[state.activeCity]?.name || 'Fairfax County'} · private on this device · ${walks} walk${walks === 1 ? '' : 's'} · ${notes} note${notes === 1 ? '' : 's'}`;
  el('journalWordCount').textContent = `${wordCount(el('journalNote').value)} words`;
  openSheet('journalSheet');
  void renderArchive();
}

export function openBackpack() {
  if (state.modalOpen === 'backpackSheet') { closeSheets(); return; }
  openSheet('backpackSheet');
  renderFieldGuide();
}
export function momentCard(item) {
  const kind = item.type === 'observation' ? 'observation' : item.type === 'history' ? 'history' : item.type === 'walk' ? 'walk' : 'journal';
  const icons = { observation: '⌁', history: '✦', walk: '↝', journal: '✎' };
  const title = item.species || item.title || 'Walk';
  let detail = item.note || '';
  if (item.type === 'walk') detail = `${formatDistance(item.distanceMeters)} miles · ${formatDuration(item.durationSeconds)}`;
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
