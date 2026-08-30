import db from './storage.js';
import { formatDistance, formatDuration } from './utils.js';
import {
  appendWatchPosition,
  finishWatchWalk,
  nearbyWatchPlaces,
  readWatchSession,
  saveWatchCapture,
  startWatchWalk,
  toggleWatchPause
} from './watch-session.js';

const view = {
  walk: null,
  places: [],
  observations: [],
  settings: null,
  position: null,
  watchId: null,
  busy: false
};

const el = (id) => document.getElementById(id);

function announce(message) {
  el('watchToast').textContent = message;
  el('watchToast').classList.add('show');
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => el('watchToast').classList.remove('show'), 3200);
}

function currentLocation() {
  return view.position || view.walk?.endLocation || view.walk?.points?.at(-1) || null;
}

function render() {
  const walk = view.walk;
  const active = walk?.recordingStatus === 'recording';
  const stopped = walk?.recordingStatus === 'stopped';
  if (active) {
    const end = Date.now();
    const elapsed = Math.max(0, Math.floor((end - new Date(walk.startedAt).getTime()) / 1000));
    walk.elapsedDurationSeconds = elapsed;
  }
  el('watchState').textContent = stopped ? 'Ready to review' : active ? (walk.paused ? 'Paused' : 'Recording') : 'Ready';
  el('watchStateDot').dataset.state = stopped ? 'review' : active ? (walk.paused ? 'paused' : 'recording') : 'ready';
  el('watchTimer').textContent = walk ? formatDuration(walk.elapsedDurationSeconds || 0) : '00:00';
  el('watchDistance').textContent = `${formatDistance(walk?.distanceMeters || 0)} mi`;
  el('watchWalkPrimary').textContent = stopped ? 'Review in full app' : active ? (walk.paused ? 'Resume walk' : 'Pause walk') : 'Start walk';
  el('watchWalkFinish').hidden = !active;
  el('watchWalkHint').textContent = stopped ? 'Your route is safe. Finish the journal entry in the full app.' : active ? 'Route changes are saved locally as you move.' : 'Start a simple open walk. Choose route details later.';
  document.querySelectorAll('[data-quick-capture]').forEach((button) => { button.disabled = view.busy; });

  const near = nearbyWatchPlaces(view.places, currentLocation());
  el('watchNearby').innerHTML = near.length
    ? near.map((place) => `<li><span><strong>${escapeText(place.name || 'Saved place')}</strong><small>${place.needsRefinement ? 'Needs a name · ' : ''}${place.distanceMeters < 1000 ? `${Math.round(place.distanceMeters)} m` : `${(place.distanceMeters / 1609.344).toFixed(1)} mi`}</small></span></li>`).join('')
    : '<li class="empty-watch-row">No saved places within a mile yet.</li>';
  const pendingCount = [...view.observations, ...view.places].filter((item) => item.needsRefinement).length;
  el('watchPendingCount').textContent = `${pendingCount} quick capture${pendingCount === 1 ? '' : 's'} to refine`;
}

function escapeText(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function positionOnce() {
  if (!navigator.geolocation) return Promise.reject(new Error('Location is not available on this device.'));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((position) => {
    const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    view.position = point;
    resolve(point);
  }, () => reject(new Error('Allow location to use this action.')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }));
}

function startPositionWatch() {
  if (!navigator.geolocation || view.watchId !== null || view.walk?.paused || view.walk?.recordingStatus !== 'recording') return;
  view.watchId = navigator.geolocation.watchPosition(async (position) => {
    view.position = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    view.walk = await appendWatchPosition(view.walk, view.position, position.timestamp || Date.now());
    render();
  }, () => announce('Location signal is unavailable. Your draft is still safe.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

function stopPositionWatch() {
  if (view.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(view.watchId);
  view.watchId = null;
}

async function handleWalkPrimary() {
  if (view.busy) return;
  if (view.walk?.recordingStatus === 'stopped') {
    window.location.href = './index.html?view=phone#journal';
    return;
  }
  view.busy = true;
  try {
    if (!view.walk) {
      const point = await positionOnce();
      view.walk = await startWatchWalk({ city: view.settings?.activeCity || 'fairfax', location: point });
      startPositionWatch();
      announce('Walk started.');
    } else {
      view.walk = await toggleWatchPause(view.walk);
      if (view.walk.paused) stopPositionWatch(); else startPositionWatch();
      announce(view.walk.paused ? 'Walk paused.' : 'Walk resumed.');
    }
  } catch (error) {
    announce(error.message);
  } finally {
    view.busy = false;
    render();
  }
}

async function handleFinish() {
  if (!view.walk || view.busy) return;
  view.busy = true;
  stopPositionWatch();
  view.walk = await finishWatchWalk(view.walk, currentLocation());
  view.busy = false;
  render();
  announce('Walk ended. Review it in the full app.');
}

async function handleCapture(kind) {
  if (view.busy) return;
  view.busy = true;
  render();
  try {
    const point = currentLocation() || await positionOnce();
    const saved = await saveWatchCapture(kind, { location: point, walk: view.walk, city: view.settings?.activeCity || 'fairfax' });
    if (kind === 'place') view.places.push(saved); else view.observations.push(saved);
    announce(kind === 'place' ? 'Place saved. Name it later in the full app.' : kind === 'history' ? 'History moment saved to revisit.' : 'Observation saved to refine later.');
  } catch (error) {
    announce(error.message);
  } finally {
    view.busy = false;
    render();
  }
}

async function init() {
  try {
    await db.open();
    Object.assign(view, await readWatchSession());
    render();
    if (view.walk?.recordingStatus === 'recording' && !view.walk.paused) startPositionWatch();
  } catch (error) {
    announce('Local journal storage could not open.');
    console.error(error);
  }
  el('watchWalkPrimary').addEventListener('click', handleWalkPrimary);
  el('watchWalkFinish').addEventListener('click', handleFinish);
  document.querySelectorAll('[data-quick-capture]').forEach((button) => button.addEventListener('click', () => handleCapture(button.dataset.quickCapture)));
  setInterval(render, 1000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

init();
