import { state } from './state.js';
import { el, cityLabel, escapeHtml, uid } from './utils.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { openSheet, closeSheets, openJournal, toast } from './ui.js';
import { renderArchive } from './archive.js';
import { buildObservationRecord } from './observation-model.js';
import { attachWalkArtifact } from './walk-context.js';
import { requestCompanionContext } from './companion.js';

function observationIcon(iconName = 'camera') {
  return L.divIcon({ className: '', html: `<div class="wildlife-marker personal-observation-marker"><img src="./icons/${escapeHtml(iconName)}.svg" alt="" /></div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
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
  el('observationLocation').textContent = `Pinned at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} in ${cityLabel(state.activeCity)}. Move it by closing this form and tapping a new spot on the map.`;
  el('observationForm').reset(); el('photoName').textContent = 'Optional, stored only on this device';
  document.querySelectorAll('[data-observation-icon]').forEach((button) => button.classList.toggle('active', button.dataset.observationIcon === state.draftObservationIcon));
  openSheet('observationSheet');
}
export function setDraftObservationIcon(iconName) {
  state.draftObservationIcon = iconName || 'camera';
  document.querySelectorAll('[data-observation-icon]').forEach((button) => button.classList.toggle('active', button.dataset.observationIcon === state.draftObservationIcon));
  renderDraftMarker();
}
export function addObservationMarker(observation) {
  const icon = observationIcon(observation.icon || 'camera');
  const marker = L.marker([observation.location.lat, observation.location.lng], { icon, title: observation.species }).addTo(state.observationLayer);
  const tags = (observation.personalTags || []).join(', ');
  marker.bindPopup(`<strong>${escapeHtml(observation.species)}</strong>${tags ? `<br><small>${escapeHtml(tags)}</small>` : ''}${observation.note ? `<br><span>${escapeHtml(observation.note)}</span>` : ''}`);
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
      coverage: null
    }),
    pointsAwarded: 0
  };
  if (personalTags.length) {
    state.settings.customObservationTags = { ...(state.settings.customObservationTags || {}), ...Object.fromEntries(personalTags.map((tag) => [tag, icon])) };
    await db.put('settings', state.settings);
  }
  await db.put('observations', observation);
  await attachWalkArtifact(observation, 'observation');
  requestCompanionContext('observe');
  await updateProfile((profile) => { profile.observationsLogged += 1; return 0; });
  addObservationMarker(observation); closeSheets(); toast('Observation saved locally.'); await renderArchive();
  if (state.observationReturnToJournal) { state.observationReturnToJournal = false; await openJournal(); }
}
