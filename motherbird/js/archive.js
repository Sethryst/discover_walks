import { state } from './state.js';
import { POINTS_PER_NEW_HISTORY_SITE } from './constants.js';
import { el, escapeHtml, formatDistance, formatDuration, shortDate, uid, sitesForProfile } from './utils.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { closeSheets, openSheet, toast, momentCard } from './ui.js';
import { city } from './poi.js';
import { buildReflectionMoment, wordCount } from './reflection.js';
import { markPoiVisited } from './poi-visit-tracking.js';

export async function saveHistoryMoment() {
  const site = state.currentSite; if (!site) return;
  const cityId = state.activeCity;
  const award = await updateProfile((profile) => {
    const discovered = sitesForProfile(profile, cityId);
    if (discovered.includes(site.id)) return { points: 0, firstDiscovery: false };
    profile.sitesDiscovered[cityId] = [...discovered, site.id];
    profile.totalPoints += POINTS_PER_NEW_HISTORY_SITE;
    return { points: POINTS_PER_NEW_HISTORY_SITE, firstDiscovery: true };
  });
  await db.put('moments', {
    id: uid('moment'), type: 'history', title: `Visited ${site.name}`,
    note: site.unverified ? 'Prototype historic-place prompt saved. Content is unverified.' : 'Historic-place prompt saved during a walk.',
    siteId: site.id, city: cityId, pointsAwarded: award.points, createdAt: new Date().toISOString(), location: { lat: site.lat, lng: site.lng }
  });
  await markPoiVisited(site);
  closeSheets(); toast(award.firstDiscovery ? `New history site — +${award.points} points.` : 'History moment saved to your local archive.'); renderArchive();
}
export async function saveJournal(event) {
  event.preventDefault();
  const mood = document.querySelector('input[name="mood"]:checked').value;
  const note = el('journalNote').value.trim();
  const walkId = event.currentTarget.dataset.walkId;
  const moment = buildReflectionMoment({ id: uid('moment'), city: state.activeCity, heading: el('journalHeading').value, mood, note, prompt: event.currentTarget.dataset.prompt, walkId, createdAt: new Date().toISOString() });
  await db.put('moments', moment);
  closeSheets(); toast(`Reflection saved locally · ${wordCount(note)} words.`); renderArchive();
}
export async function saveQuickJournal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const note = el('quickJournalNote').value.trim();
  const file = el('quickJournalPhoto').files[0];
  if (!note && !file) { toast('Write a thought or add a photo first.'); return; }
  let photo = null;
  if (file) photo = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
  await db.put('moments', {
    id: uid('moment'), type: 'journal', title: note ? 'Field note' : 'Photograph', mood: 'Noticed',
    note: note || 'A photograph from this place.', prompt: null, createdAt: new Date().toISOString(),
    walkId: state.activeWalk?.id || null, city: state.activeCity, photo,
    location: state.currentPosition || (state.map ? { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng } : null)
  });
  form.reset();
  el('quickJournalPhotoName').textContent = 'Private on this device';
  toast('Added to your journal.');
  await renderArchive();
}
export async function renderArchive() {
  let items = await allArchiveItems();
  if (state.archiveFilter === 'walk') items = items.filter((item) => item.type === 'walk' || item.type === 'journal');
  if (state.archiveFilter === 'observation') items = items.filter((item) => item.type === 'observation');
  el('archiveList').innerHTML = items.length ? items.map(momentCard).join('') : '<div class="empty-state">No matching moments yet. Start a walk or write from the map.</div>';
  await renderJournalTimeline();
}

function timelineEvent({ icon, label, title, detail, createdAt, photo = null, active = false }) {
  const time = new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `<article class="timeline-event ${active ? 'active' : ''}"><time>${escapeHtml(time)}</time><span class="timeline-dot">${icon}</span><div><small>${escapeHtml(label)}</small><strong>${escapeHtml(title)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}${photo ? `<img src="${photo}" alt="Journal photograph" />` : ''}</div></article>`;
}

export async function renderJournalTimeline() {
  const target = el('journalTimeline');
  if (!target) return;
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  const events = [];
  walks.forEach((walk) => {
    events.push({ icon: '↝', label: 'Walk', title: 'Walk started', detail: `${formatDistance(walk.distanceMeters)} miles`, createdAt: walk.startedAt });
    if (walk.endedAt) events.push({ icon: '✓', label: 'Walk', title: 'Walk ended', detail: formatDuration(walk.durationSeconds), createdAt: walk.endedAt });
  });
  observations.forEach((item) => events.push({ icon: '⌁', label: 'Observation', title: item.species || 'Observation', detail: item.note || (item.personalTags || []).join(', '), createdAt: item.createdAt, photo: item.photo }));
  moments.forEach((item) => events.push({ icon: item.type === 'history' ? '✦' : '“', label: item.type === 'history' ? 'Place remembered' : 'Thought', title: item.title || 'Field note', detail: item.note, createdAt: item.createdAt, photo: item.photo }));
  if (state.activeWalk) events.push({ icon: '●', label: 'Walk in progress', title: 'Walk started', detail: `${formatDistance(state.activeWalk.distanceMeters)} miles so far`, createdAt: state.activeWalk.startedAt, active: true });
  events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  target.innerHTML = events.length ? events.slice(-12).map(timelineEvent).join('') : '<div class="journal-empty"><span>⌁</span><strong>Your walk begins here.</strong><p>Write a thought, add a photograph, or start walking. The timeline will grow with you.</p></div>';
  const latest = events.at(-1);
  const preview = el('journalCollapsedPreview');
  if (preview) preview.textContent = latest ? `${new Date(latest.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${latest.title}` : 'A place becomes a memory when you pause to notice it.';
  requestAnimationFrame(() => { target.scrollTop = target.scrollHeight; });
}
export async function openWalkDetail(id) {
  const walk = await db.get('walks', id); if (!walk) return;
  const moments = await db.all('moments'); const reflection = moments.find((item) => item.type === 'journal' && item.walkId === id);
  let sheet = el('walkDetailSheet');
  if (!sheet) { sheet = document.createElement('section'); sheet.id = 'walkDetailSheet'; sheet.className = 'sheet tall-sheet hidden'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); document.body.append(sheet); }
  sheet.innerHTML = `<button class="close-sheet" data-close-walk-detail aria-label="Close">x</button><span class="sheet-kicker">SAVED WALK</span><h2>${escapeHtml(shortDate(walk.startedAt))} walk</h2><div class="walk-detail-stats"><div><strong>${formatDistance(walk.distanceMeters)}</strong><span>Miles</span></div><div><strong>${formatDuration(walk.durationSeconds)}</strong><span>Duration</span></div></div><div id="walkDetailMap" class="walk-detail-map"></div>${reflection ? `<section class="walk-reflection"><p class="sheet-kicker">${escapeHtml(reflection.title)}</p><p>${escapeHtml(reflection.note)}</p></section>` : '<p class="empty-state">No reflection was saved for this walk.</p>'}`;
  sheet.querySelector('[data-close-walk-detail]').addEventListener('click', () => { state.walkDetailMap?.remove(); state.walkDetailMap = null; closeSheets(); }); openSheet('walkDetailSheet');
  setTimeout(() => { const points = walk.points || []; state.walkDetailMap?.remove(); state.walkDetailMap = L.map('walkDetailMap', { zoomControl: false, attributionControl: false }); if (points.length) { const latLngs = points.map((point) => [point.lat, point.lng]); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.walkDetailMap); L.polyline(latLngs, { color: '#245448', weight: 5 }).addTo(state.walkDetailMap); state.walkDetailMap.fitBounds(latLngs, { padding: [22, 22], maxZoom: 17 }); } else { state.walkDetailMap.setView([city().center.lat, city().center.lng], city().zoom); } }, 20);
}
export async function allArchiveItems() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  return [...walks.map((walk) => ({ ...walk, type: 'walk', createdAt: walk.startedAt })), ...observations, ...moments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
