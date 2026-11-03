import { state } from './state.js';
import { el, escapeHtml, uid } from './utils.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { openSheet, closeSheets, openJournal, toast } from './ui.js';
import { renderArchive } from './archive.js';
import { buildObservationRecord } from './observation-model.js';
import { attachWalkArtifact } from './walk-context.js';
import { requestCompanionContext } from './companion.js';
import { appendRoomTrace } from './room-runtime.js';

const OBSERVATION_ASSETS = {
  bird: 'bird-map', tree: 'tree-taxonomy', 'paw-print': 'paw-print-taxonomy',
  bug: 'bug-taxonomy', mushroom: 'mushroom-taxonomy', turtle: 'turtle-taxonomy',
  microscope: 'microscope-taxonomy', leaf: 'leaf-taxonomy', coffee: 'coffee-map',
  utensils: 'utensils-taxonomy'
};

function observationIcon(iconName = 'camera') {
  const safeName = String(iconName || 'camera').replace(/[^a-z0-9-]/gi, '') || 'camera';
  const asset = OBSERVATION_ASSETS[safeName] || safeName;
  return L.divIcon({ className: '', html: `<div class="wildlife-marker personal-observation-marker"><img src="./icons/${escapeHtml(asset)}.svg" alt="" /></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}
function renderDraftMarker() {
  if (state.draftMarker) state.draftMarker.remove();
  if (!state.draftObservationLocation) return;
  state.draftMarker = L.marker([state.draftObservationLocation.lat, state.draftObservationLocation.lng], { icon: observationIcon(state.draftObservationIcon) }).addTo(state.map);
}

export function openObservation(location) {
  state.observationReturnToJournal = state.modalOpen === 'journalSheet';
  const loc = location || state.currentPosition || { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng };
  state.draftObservationLocation = loc;
  state.draftObservationIcon = 'camera';
  renderDraftMarker();
  el('observationForm').reset();
  openSheet('observationSheet');
}
export function addObservationMarker(observation) {
  const icon = observationIcon(observation.icon || 'camera');
  const marker = L.marker([observation.location.lat, observation.location.lng], { icon, title: observation.species, observationIcon: observation.icon || 'camera' }).addTo(state.observationLayer);
  const tags = (observation.personalTags || []).join(', ');
  marker.bindPopup(`<strong>${escapeHtml(observation.species)}</strong>${tags ? `<br><small>${escapeHtml(tags)}</small>` : ''}${observation.note ? `<br><span>${escapeHtml(observation.note)}</span>` : ''}`);
}
export function addJournalMarker(moment) {
  if (!moment?.location || !state.observationLayer) return;
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker personal-observation-marker journal-map-marker">✎</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
  const marker = L.marker([moment.location.lat, moment.location.lng], { icon, title: moment.title || 'Journal entry', observationIcon: 'microscope' }).addTo(state.observationLayer);
  marker.bindPopup(`<strong>${escapeHtml(moment.title || 'Journal entry')}</strong>${moment.note ? `<br><span>${escapeHtml(moment.note)}</span>` : ''}`);
}
export async function saveObservation(event) {
  event.preventDefault();
  const file = el('photoInput').files[0];
  let photo = null;
  if (file) photo = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
  const personalTags = [];
  const icon = state.draftObservationIcon || 'camera';
  const aspect = 'presence';
  const observation = {
    ...buildObservationRecord({
      id: uid('observation'),
      city: state.activeCity,
      aspect,
      category: 'other',
      title: el('speciesInput').value.trim(),
      note: el('observationNote').value.trim(),
      personalTags,
      icon,
      photo,
      location: state.draftObservationLocation,
      walkId: state.activeWalk?.id || null,
      roomId: state.activeRoom?.id || null,
      coverage: null
    }),
    pointsAwarded: 0
  };
  if (personalTags.length) {
    state.settings.customObservationTags = { ...(state.settings.customObservationTags || {}), ...Object.fromEntries(personalTags.map((tag) => [tag, icon])) };
    await db.put('settings', state.settings);
  }
  await db.put('observations', observation);
  if (observation.roomId) await appendRoomTrace(observation.roomId, { type: 'observation', refId: observation.id, location: observation.location });
  await attachWalkArtifact(observation, 'observation');
  requestCompanionContext('observe');
  await updateProfile((profile) => { profile.observationsLogged += 1; return 0; });
  addObservationMarker(observation); closeSheets(); toast('Observation saved locally.'); await renderArchive();
  if (state.observationReturnToJournal) { state.observationReturnToJournal = false; await openJournal(); }
}

