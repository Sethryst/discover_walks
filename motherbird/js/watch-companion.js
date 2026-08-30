import { distanceMeters } from './geo.js';
import { state } from './state.js';
import { el, escapeHtml, formatDistance, formatDuration } from './utils.js';

export function watchCompanionModel({ walk = null, position = null, personalPlaces = [], plannedRoute = null } = {}) {
  if (!walk) return { active: false, status: 'No walk in progress', controls: { canPause: false, canEnd: false, canObserve: false }, nearbySaved: [] };
  const nearbySaved = personalPlaces.filter((place) => place.state === 'saved' && place.location && position)
    .map((place) => ({ id: place.id, name: place.name || 'Saved place', distanceMeters: distanceMeters(position, place.location) }))
    .filter((place) => place.distanceMeters <= 1200).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 2);
  const stopped = walk.recordingStatus === 'stopped';
  return {
    active: true,
    status: stopped ? 'Ready to review' : walk.paused ? 'Paused' : 'Recording',
    distance: formatDistance(walk.distanceMeters || 0),
    duration: formatDuration(walk.elapsedDurationSeconds || 0),
    navigation: plannedRoute?.title || (walk.routeMode === 'point-to-point' ? 'Point-to-point walk' : walk.routeMode === 'round-trip' ? 'Round trip' : 'Open walk'),
    controls: { canPause: !stopped, canEnd: !stopped, canObserve: !stopped },
    nearbySaved
  };
}

export function renderWatchCompanion() {
  const target = el('watchCompanionPanel');
  if (!target) return null;
  const model = watchCompanionModel({ walk: state.activeWalk, position: state.currentPosition, personalPlaces: state.personalPlaces, plannedRoute: state.plannedRoute });
  target.classList.toggle('hidden', !model.active);
  if (!model.active) return model;
  el('watchWalkStatus').textContent = model.status;
  el('watchWalkMetrics').textContent = `${model.distance} mi · ${model.duration}`;
  el('watchNavigationSummary').textContent = model.navigation;
  el('watchPauseButton').textContent = state.activeWalk?.paused ? 'Resume' : 'Pause';
  el('watchPauseButton').disabled = !model.controls.canPause;
  el('watchEndButton').disabled = !model.controls.canEnd;
  el('watchObservationButton').disabled = !model.controls.canObserve;
  el('watchNearbySaved').innerHTML = model.nearbySaved.length ? model.nearbySaved.map((place) => `<li><strong>${escapeHtml(place.name)}</strong><span>${place.distanceMeters < 1000 ? `${Math.round(place.distanceMeters)} m` : `${(place.distanceMeters / 1609.344).toFixed(1)} mi`}</span></li>`).join('') : '<li><span>No saved personal places within a short walk.</span></li>';
  return model;
}

export function initWatchCompanion() {
  el('watchPauseButton')?.addEventListener('click', async () => { const { togglePauseWalk } = await import('./walk.js'); await togglePauseWalk(); });
  el('watchEndButton')?.addEventListener('click', async () => { const { stopWalk } = await import('./walk.js'); await stopWalk(); });
  el('watchObservationButton')?.addEventListener('click', async () => { const { openObservation } = await import('./observation.js'); openObservation(); });
  window.addEventListener('walk-display-updated', renderWatchCompanion);
  window.addEventListener('personal-places-changed', renderWatchCompanion);
  renderWatchCompanion();
}
