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
export async function renderArchive() {
  let items = await allArchiveItems();
  if (state.archiveFilter === 'walk') items = items.filter((item) => item.type === 'walk' || item.type === 'journal');
  if (state.archiveFilter === 'observation') items = items.filter((item) => item.type === 'observation');
  el('archiveList').innerHTML = items.length ? items.map(momentCard).join('') : '<div class="empty-state">No matching moments yet. Start a walk or add an observation from the map.</div>';
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
