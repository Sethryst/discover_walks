import { state } from './state.js';
import { POINTS_PER_NEW_HISTORY_SITE } from './constants.js';
import { el, escapeHtml, formatDistance, formatDuration, shortDate, uid, sitesForProfile } from './utils.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { closeSheets, openSheet, toast, momentCard } from './ui.js';
import { city } from './poi.js';
import { buildReflectionMoment, wordCount } from './reflection.js';
import { markPoiVisited } from './poi-visit-tracking.js';
import { attachWalkArtifact } from './walk-context.js';
import { requestCompanionContext } from './companion.js';

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
  requestCompanionContext('discover');
  closeSheets(); toast(award.firstDiscovery ? `New history site — +${award.points} points.` : 'History moment saved to your local archive.'); renderArchive();
}
export async function saveJournal(event) {
  event.preventDefault();
  const mood = document.querySelector('input[name="mood"]:checked').value;
  const note = el('journalNote').value.trim();
  const walkId = event.currentTarget.dataset.walkId;
  const moment = buildReflectionMoment({ id: uid('moment'), city: state.activeCity, heading: el('journalHeading').value, mood, note, prompt: event.currentTarget.dataset.prompt, walkId, createdAt: new Date().toISOString() });
  await db.put('moments', moment);
  requestCompanionContext('journal');
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
  const createdAt = new Date().toISOString();
  const moment = {
    id: uid('moment'), type: 'journal', title: note ? 'Field note' : 'Photograph', mood: 'Noticed',
    note: note || 'A photograph from this place.', prompt: null, createdAt,
    walkId: state.activeWalk?.id || null, city: state.activeCity, photo,
    media: { photo: Boolean(photo), transcribedVoice: form.dataset.voiceTranscript === 'true' },
    location: state.currentPosition || (state.map ? { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng } : null)
  };
  await db.put('moments', moment);
  if (form.dataset.voiceTranscript === 'true') {
    await db.put('voice_notes', { id: `voice-${moment.id}`, momentId: moment.id, walkId: moment.walkId, transcript: moment.note, createdAt, location: moment.location, private: true });
  }
  await attachWalkArtifact(moment, photo ? 'photo' : form.dataset.voiceTranscript === 'true' ? 'voice-note' : 'moment');
  requestCompanionContext('journal');
  form.reset();
  form.dataset.voiceTranscript = 'false';
  el('quickJournalPhotoName').textContent = 'Private on this device';
  toast('Added to your journal.');
  await renderArchive();
}
export async function renderArchive() {
  let items = await allArchiveItems();
  if (state.archiveFilter === 'walk') items = items.filter((item) => item.type === 'walk' || item.type === 'journal');
  if (state.archiveFilter === 'observation') items = items.filter((item) => item.type === 'observation');
  const html = items.length ? items.map(momentCard).join('') : '<div class="empty-state">No matching moments yet. Start a walk or write from the map.</div>';
  if (el('archiveList')) el('archiveList').innerHTML = html;
  if (el('journalOverlayArchiveList')) el('journalOverlayArchiveList').innerHTML = html;
  const all = await allArchiveItems();
  const walks = all.filter((item) => item.type === 'walk');
  const notes = all.filter((item) => item.type === 'journal' || item.type === 'observation');
  const miles = walks.reduce((sum, walk) => sum + Number(walk.distanceMeters || 0) / 1609.344, 0);
  if (el('journalArchiveSummary')) el('journalArchiveSummary').textContent = `${walks.length} walk${walks.length === 1 ? '' : 's'} · ${miles.toFixed(1)} mi · ${notes.length} note${notes.length === 1 ? '' : 's'}`;
  await renderJournalTimeline();
}

function timelineEvent({ icon, label, title, detail, createdAt, photo = null, active = false }) {
  const date = new Date(createdAt);
  const stamp = `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `<article class="timeline-event ${active ? 'active' : ''}"><time>${escapeHtml(stamp)}</time><span class="timeline-dot">${icon}</span><div><small>${escapeHtml(label)}</small><strong>${escapeHtml(title)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}${photo ? `<img src="${photo}" alt="Journal photograph" />` : ''}</div></article>`;
}

export async function renderJournalTimeline() {
  const target = el('journalTimeline');
  if (!target) return;
  const [walks, observations, moments, personalPlaces] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments'), db.all('personal_places')]);
  const events = [];
  walks.forEach((walk) => {
    events.push({ icon: '↝', label: 'Walk', title: 'Walk started', detail: `${formatDistance(walk.distanceMeters)} miles`, createdAt: walk.startedAt });
    (walk.events || []).forEach((event) => events.push({ icon: event.type === 'poi-encounter' ? '✦' : event.type === 'photo-stop' ? '◉' : '·', label: 'Walk event', title: event.type.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '), detail: event.metadata?.name || (event.durationSeconds ? formatDuration(event.durationSeconds) : ''), createdAt: event.timestamp }));
    if (walk.endedAt) events.push({ icon: '✓', label: 'Walk', title: 'Walk ended', detail: formatDuration(walk.durationSeconds), createdAt: walk.endedAt });
  });
  observations.forEach((item) => events.push({ icon: '⌁', label: 'Observation', title: item.species || 'Observation', detail: item.note || (item.personalTags || []).join(', '), createdAt: item.createdAt, photo: item.photo }));
  moments.forEach((item) => events.push({ icon: item.type === 'history' ? '✦' : '“', label: item.type === 'history' ? 'Place remembered' : 'Thought', title: item.title || 'Field note', detail: item.note, createdAt: item.createdAt, photo: item.photo }));
  personalPlaces.filter((place) => (place.stopCount || 0) > 1 || (place.returnCount || 0) > 0).forEach((place) => events.push({ icon: '⌖', label: 'Personal place pattern', title: place.name || 'An unnamed place in your journal', detail: place.fact, createdAt: place.lastObservedAt }));
  if (state.activeWalk) {
    events.push({ icon: '●', label: state.activeWalk.recordingStatus === 'stopped' ? 'Walk awaiting review' : 'Walk in progress', title: state.activeWalk.recordingStatus === 'stopped' ? 'Save or discard this walk' : 'Walk started', detail: `${formatDistance(state.activeWalk.distanceMeters)} miles so far`, createdAt: state.activeWalk.startedAt, active: true });
    (state.activeWalk.events || []).forEach((event) => events.push({ icon: '·', label: 'Walk event', title: event.type.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '), detail: event.metadata?.name || '', createdAt: event.timestamp }));
  }
  events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  target.innerHTML = events.length ? events.slice(-12).map(timelineEvent).join('') : '';
  const latest = events.at(-1);
  const preview = el('journalCollapsedPreview');
  if (preview) preview.textContent = latest ? `${new Date(latest.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${new Date(latest.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${latest.title}` : 'No entries yet';
  requestAnimationFrame(() => { target.scrollTop = target.scrollHeight; });
}
export async function openWalkDetail(id) {
  const walk = await db.get('walks', id); if (!walk) return;
  const [moments, observations] = await Promise.all([db.all('moments'), db.all('observations')]);
  const reflection = moments.find((item) => item.type === 'journal' && item.walkId === id);
  const linkedObservations = observations.filter((item) => item.walkId === id);
  const eventRows = (walk.events || []).map((event) => `<li><strong>${escapeHtml(event.type.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '))}</strong><span>${escapeHtml(new Date(event.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${event.durationSeconds ? ` · ${escapeHtml(formatDuration(event.durationSeconds))}` : ''}</span></li>`).join('');
  let sheet = el('walkDetailSheet');
  if (!sheet) { sheet = document.createElement('section'); sheet.id = 'walkDetailSheet'; sheet.className = 'sheet tall-sheet hidden'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); document.body.append(sheet); }
  sheet.innerHTML = `<button class="close-sheet" data-close-walk-detail aria-label="Close">x</button><span class="sheet-kicker">SAVED WALK</span><h2>${escapeHtml(shortDate(walk.startedAt))} walk</h2><div class="walk-detail-stats"><div><strong>${formatDistance(walk.distanceMeters)}</strong><span>Miles</span></div><div><strong>${formatDuration(walk.elapsedDurationSeconds ?? walk.durationSeconds)}</strong><span>Elapsed</span></div><div><strong>${formatDuration(walk.movingDurationSeconds || 0)}</strong><span>Moving</span></div></div><div id="walkDetailMap" class="walk-detail-map"></div><button class="secondary-button wide-button" id="replayWalkButton" type="button">Replay recorded route</button>${eventRows ? `<section class="walk-review-events"><div><strong>Walk events</strong><span>${walk.events.length} factual artifact${walk.events.length === 1 ? '' : 's'}</span></div><ul>${eventRows}</ul></section>` : ''}${linkedObservations.length ? `<section class="walk-reflection"><p class="sheet-kicker">OBSERVATIONS</p><p>${escapeHtml(linkedObservations.map((item) => item.title || item.species).join(' · '))}</p></section>` : ''}${reflection ? `<section class="walk-reflection"><p class="sheet-kicker">${escapeHtml(reflection.title)}</p><p>${escapeHtml(reflection.note)}</p></section>` : '<p class="empty-state">No reflection was saved for this walk.</p>'}`;
  let replayTimer = null;
  sheet.querySelector('[data-close-walk-detail]').addEventListener('click', () => { clearInterval(replayTimer); state.walkDetailMap?.remove(); state.walkDetailMap = null; closeSheets(); }); openSheet('walkDetailSheet');
  setTimeout(() => {
    const points = walk.points || [];
    state.walkDetailMap?.remove();
    state.walkDetailMap = L.map('walkDetailMap', { zoomControl: false, attributionControl: false });
    if (points.length) {
      const latLngs = points.map((point) => [point.lat, point.lng]);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.walkDetailMap);
      L.polyline(latLngs, { color: '#245448', weight: 5 }).addTo(state.walkDetailMap);
      state.walkDetailMap.fitBounds(latLngs, { padding: [22, 22], maxZoom: 17 });
      const marker = L.circleMarker(latLngs[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#7ca900', fillOpacity: 1 }).addTo(state.walkDetailMap);
      el('replayWalkButton').addEventListener('click', () => {
        clearInterval(replayTimer);
        let index = 0;
        marker.setLatLng(latLngs[0]);
        replayTimer = setInterval(() => { if (index >= latLngs.length - 1) { clearInterval(replayTimer); return; } index += 1; marker.setLatLng(latLngs[index]); }, Math.max(45, Math.min(240, 5000 / latLngs.length)));
      });
    } else {
      state.walkDetailMap.setView([city().center.lat, city().center.lng], city().zoom);
      el('replayWalkButton').disabled = true;
      el('replayWalkButton').textContent = 'No GPS points to replay';
    }
  }, 20);
}
export async function allArchiveItems() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  return [...walks.map((walk) => ({ ...walk, type: 'walk', createdAt: walk.startedAt })), ...observations, ...moments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
