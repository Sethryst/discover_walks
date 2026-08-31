import { renderUserLocation } from './map.js';
import { distanceMeters } from './geo.js';
import { state } from './state.js';
import {
  MAX_GPS_ACCURACY_METERS,
  MAX_WALK_SPEED_MPS,
  POINTS_PER_MILE,
  STREAK_BONUS_PER_DAY
} from './constants.js';
import { el, uid, formatDuration, formatDistance, dayKey, previousDayKey, escapeHtml } from './utils.js';
import { checkGeofences } from './geofence.js';
import { toast, setStatus, openJournal, openSheet, closeSheets } from './ui.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { renderArchive } from './archive.js';
import {
  addEventToWalk,
  completeWalkEvent,
  createWalkArtifact,
  createWalkEvent,
  detectTrackEvents,
  normalizeWalkArtifact,
  updateWalkDurations,
  walkReviewSummary
} from './walk-artifact.js';
import { companionStateForWalk, setCompanionState } from './companion.js';
import { refreshNearbyRevisit } from './revisit.js';

const DRAFT_ID = 'active-walk';

export function addWalkPoint(point) {
  const walk = state.activeWalk;
  if (!walk || walk.paused || walk.recordingStatus !== 'recording') return;
  if (!Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS) return;
  const points = walk.points;
  const last = points.at(-1);
  const lastRaw = walk.lastRawPoint;
  const now = Number(point.capturedAtMs) || Date.now();
  if (lastRaw) {
    const elapsedSeconds = Math.max(1, (now - lastRaw.capturedAtMs) / 1000);
    if (distanceMeters(lastRaw, point) / elapsedSeconds > MAX_WALK_SPEED_MPS) return;
  }
  walk.lastRawPoint = { ...point, capturedAtMs: now };

  if (last && distanceMeters(last, point) < 7) {
    if (now - new Date(walk.lastMovementAt || walk.startedAt).getTime() >= 120000 && !walk.detectionState?.autoPauseEventId) {
      void recordWalkEvent('pause', point, { automatic: true, reason: 'stationary-position-samples' }, undefined, 'active').then((event) => {
        if (event) walk.detectionState.autoPauseEventId = event.id;
      });
    }
    void persistWalkDraft();
    return;
  }

  const samples = [...points.slice(-2), point];
  const capturedAt = new Date(now).toISOString();
  const smoothed = {
    lat: samples.reduce((sum, sample) => sum + sample.lat, 0) / samples.length,
    lng: samples.reduce((sum, sample) => sum + sample.lng, 0) / samples.length,
    accuracy: point.accuracy,
    capturedAt
  };
  const segmentDistance = last ? distanceMeters(last, smoothed) : 0;
  const segmentSeconds = last ? Math.max(0, (now - new Date(last.capturedAt || capturedAt).getTime()) / 1000) : 0;
  walk.points.push(smoothed);
  walk.distanceMeters += segmentDistance;
  if (!walk.startLocation) walk.startLocation = copyLocation(smoothed);
  walk.endLocation = copyLocation(smoothed);
  walk.lastMovementAt = capturedAt;
  if (segmentSeconds && segmentDistance / Math.max(1, segmentSeconds) >= 0.35) walk.movingDurationSeconds += Math.min(30, Math.round(segmentSeconds));

  if (walk.detectionState?.autoPauseEventId) {
    void completeEventById(walk.detectionState.autoPauseEventId, capturedAt, { resumedByMovement: true });
    walk.detectionState.autoPauseEventId = null;
  }
  const detections = detectTrackEvents({ walk, point: smoothed, previousPoint: last, knownTrackPoints: state.knownTrackPoints, nowMs: now });
  detections.forEach((event) => void recordWalkEvent(event.type, event.location, event.metadata, event.timestamp));

  if (!state.routeLine) state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  state.routeLine.addLatLng([smoothed.lat, smoothed.lng]);
  updateWalkDisplay();
  void persistWalkDraft();
}

export function updateWalkDisplay() {
  const walk = state.activeWalk;
  if (!walk) {
    el('walkDuration').textContent = '00:00';
    el('walkDistance').textContent = '0.00';
    el('walkPoints')?.replaceChildren();
    el('activeRouteButton').classList.add('hidden');
    el('walkingTopbar').classList.add('hidden');
    setCompanionState('idle');
    document.body.classList.remove('walk-active');
    globalThis.window?.dispatchEvent(new CustomEvent('walk-display-updated'));
    return;
  }
  document.body.classList.add('walk-active');
  updateWalkDurations(walk);
  const distance = formatDistance(walk.distanceMeters);
  const duration = formatDuration(walk.elapsedDurationSeconds);
  el('walkDuration').textContent = duration;
  el('walkDistance').textContent = distance;
  el('activeRouteButton').classList.remove('hidden');
  el('activeRouteSummary').textContent = `${distance} mi · ${duration}`;
  el('routeSheetDistance').textContent = `${distance} mi`;
  el('routeSheetDuration').textContent = `${duration} elapsed · ${formatDuration(walk.movingDurationSeconds)} moving`;
  if (el('routePauseButton')) el('routePauseButton').textContent = walk.paused ? 'Resume' : 'Pause';
  if (el('activeWalkMode')) el('activeWalkMode').value = walk.routeMode || 'tracking';
  el('walkingTopbar').classList.remove('hidden');
  setCompanionState(companionStateForWalk(walk));
  const status = walk.recordingStatus === 'stopped' ? 'Ready to review and save' : walk.paused ? 'Walk paused — your route is saved' : `Recording · ${distance} mi · ${duration}`;
  el('walkingTopbarStatus').textContent = status;
  globalThis.window?.dispatchEvent(new CustomEvent('walk-display-updated'));
}

export function handlePosition(position, shouldPan = false) {
  const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, capturedAtMs: position.timestamp || Date.now() };
  renderUserLocation(point, shouldPan);
  void refreshNearbyRevisit(point);
  const weakSignal = !Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS;
  if (weakSignal) { setStatus(`GPS signal weak (${Math.round(point.accuracy || 0)} m) - route not updated`); return; }
  setStatus(state.activeWalk ? (state.activeWalk.paused ? 'Walk paused' : 'Recording your walk') : 'Location found', Boolean(state.activeWalk && !state.activeWalk.paused));
  if (state.activeWalk) addWalkPoint(point);
  checkGeofences(point);
}

export function getCurrentLocation() {
  if (!navigator.geolocation) { toast('This browser does not support location. Try the history preview instead.'); return; }
  setStatus('Finding your location...', true);
  navigator.geolocation.getCurrentPosition(
    (position) => handlePosition(position, true),
    (error) => { setStatus('Location unavailable'); toast(error.code === 1 ? 'Location permission is needed to record a walk.' : 'Could not get a location. Your draft remains safe; check your signal and try again.'); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
  );
}

export function ensurePauseButton() {
  let button = el('pauseWalkButton');
  if (!button) {
    button = document.createElement('button');
    button.id = 'pauseWalkButton';
    button.type = 'button';
    button.className = 'secondary-button';
    el('walkButton').before(button);
    button.addEventListener('click', togglePauseWalk);
  }
  button.classList.remove('hidden');
  button.textContent = state.activeWalk?.paused ? 'Resume' : 'Pause';
}

export async function pauseWalk() {
  const walk = state.activeWalk;
  if (!walk || walk.recordingStatus !== 'recording' || walk.paused) return;
  walk.paused = true;
  walk.pausedAt = new Date().toISOString();
  const event = await recordWalkEvent('pause', walk.endLocation || state.currentPosition, { automatic: false, reason: 'user-paused-recording' }, walk.pausedAt, 'active');
  walk.detectionState.manualPauseEventId = event?.id || null;
  el('pauseWalkButton').textContent = 'Resume';
  setStatus('Walk paused');
  updateWalkDisplay();
  await persistWalkDraft();
}

export async function resumeWalk() {
  const walk = state.activeWalk;
  if (!walk || !walk.paused || walk.recordingStatus !== 'recording') return;
  const resumedAt = new Date().toISOString();
  walk.pausedMilliseconds += Date.now() - new Date(walk.pausedAt).getTime();
  walk.paused = false;
  walk.pausedAt = null;
  walk.lastRawPoint = null;
  if (walk.detectionState?.manualPauseEventId) await completeEventById(walk.detectionState.manualPauseEventId, resumedAt, { resumedByUser: true });
  walk.detectionState.manualPauseEventId = null;
  el('pauseWalkButton').textContent = 'Pause';
  setStatus('Recording your walk', true);
  updateWalkDisplay();
  await persistWalkDraft();
}

export function togglePauseWalk() {
  return state.activeWalk?.paused ? resumeWalk() : pauseWalk();
}

export async function startWalk({ routeMode = 'tracking' } = {}) {
  if (state.activeWalk) return state.activeWalk;
  if (!navigator.geolocation) { toast('Location is not supported in this browser.'); return null; }
  state.activeWalk = createWalkArtifact({
    id: uid('walk'),
    city: state.activeCity,
    routeMode,
    plannedRouteId: state.plannedRoute?.id || null
  });
  ensurePauseButton();
  state.routeLine?.remove();
  state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  el('walkButton').innerHTML = '<span aria-hidden="true">●</span> Walk details';
  el('walkButton').classList.add('walking');
  setStatus('Recording your walk', true);
  updateWalkDisplay();
  await persistWalkDraft();
  void renderArchive();
  beginGpsWatch();
  getCurrentLocation();
  toast('Walk started. Your route is being saved on this device.');
  return state.activeWalk;
}

export function calculateWalkAward(walk, profile = state.profile) {
  const miles = (walk.distanceMeters || 0) / 1609.344;
  const today = dayKey();
  const firstWalkToday = profile.lastWalkDate !== today;
  const nextStreak = !firstWalkToday ? profile.streakDays : (profile.lastWalkDate === previousDayKey(today) ? profile.streakDays + 1 : 1);
  const distancePoints = Math.round(miles * POINTS_PER_MILE);
  const streakPoints = firstWalkToday ? STREAK_BONUS_PER_DAY : 0;
  return { miles, date: today, firstWalkToday, nextStreak, distancePoints, streakPoints, total: distancePoints + streakPoints };
}

export async function stopWalk() {
  const walk = state.activeWalk;
  if (!walk) return;
  stopGpsWatch();
  const endedAt = new Date().toISOString();
  if (walk.paused && walk.detectionState?.manualPauseEventId) await completeEventById(walk.detectionState.manualPauseEventId, endedAt, { completedWhenWalkStopped: true });
  if (walk.detectionState?.autoPauseEventId) await completeEventById(walk.detectionState.autoPauseEventId, endedAt, { completedWhenWalkStopped: true });
  walk.paused = false;
  walk.pausedAt = null;
  walk.endedAt = endedAt;
  walk.endLocation = copyLocation(walk.points.at(-1) || state.currentPosition);
  walk.recordingStatus = 'stopped';
  updateWalkDurations(walk, new Date(endedAt).getTime());
  await persistWalkDraft();
  updateWalkDisplay();
  renderWalkReview();
  openSheet('walkReviewSheet');
}

export async function saveWalk() {
  const walk = state.activeWalk;
  if (!walk || walk.recordingStatus !== 'stopped') return;
  const finished = normalizeWalkArtifact({ ...walk, points: [...walk.points], events: [...walk.events] });
  finished.recordingStatus = 'saved';
  finished.saved = true;
  finished.savedAt = new Date().toISOString();
  const award = await updateProfile((profile) => {
    const score = calculateWalkAward(finished, profile);
    profile.totalPoints += score.total;
    profile.walksCompleted += 1;
    profile.milesTotal += score.miles;
    if (score.firstWalkToday) { profile.streakDays = score.nextStreak; profile.lastWalkDate = score.date; }
    return score;
  });
  finished.pointsAwarded = award.total;
  finished.events = finished.events.map((event) => ({ ...event, state: 'historical', immutable: true, metadata: { ...(event.metadata || {}), priorState: event.state } }));
  await Promise.all([
    db.put('walks', finished),
    ...finished.events.map((event) => db.put('walk_events', event)),
    db.remove('walk_drafts', DRAFT_ID)
  ]);
  await updatePersonalPlaceCandidates(finished);
  state.walks = [...state.walks.filter((item) => item.id !== finished.id), finished];
  state.knownTrackPoints.push(...finished.points.filter((_, index) => index % 5 === 0));
  resetActiveWalk();
  closeSheets();
  setStatus('Walk saved locally');
  toast(`Walk saved with its route and ${finished.events.length} event${finished.events.length === 1 ? '' : 's'}.`);
  await renderArchive();
  openJournal(finished.id);
}

export async function discardWalk() {
  const walk = state.activeWalk;
  if (!walk || walk.recordingStatus !== 'stopped') return;
  await Promise.all([
    db.remove('walk_drafts', DRAFT_ID),
    ...(walk.events || []).map((event) => db.remove('walk_events', event.id))
  ]);
  resetActiveWalk();
  closeSheets();
  toast('Unsaved walk discarded.');
  await renderArchive();
}

export async function recoverWalkDraft() {
  const draft = await db.get('walk_drafts', DRAFT_ID);
  if (!draft?.walk || !['recording', 'stopped'].includes(draft.walk.recordingStatus)) return null;
  state.activeWalk = normalizeWalkArtifact(draft.walk);
  state.routeLine?.remove();
  state.routeLine = L.polyline(state.activeWalk.points.map((point) => [point.lat, point.lng]), { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  ensurePauseButton();
  el('walkButton').innerHTML = '<span aria-hidden="true">●</span> Walk details';
  el('walkButton').classList.add('walking');
  updateWalkDisplay();
  if (state.activeWalk.recordingStatus === 'recording') {
    // Treat time while the page was unavailable as a GPS gap, not as proof
    // that the walker was stationary or moving at a particular speed.
    state.activeWalk.lastRawPoint = null;
    state.activeWalk.lastMovementAt = new Date().toISOString();
    beginGpsWatch();
    toast('Recovered your in-progress walk and its recorded route.');
  } else {
    renderWalkReview();
    openSheet('walkReviewSheet');
    toast('Recovered an unsaved walk for review.');
  }
  void renderArchive();
  return state.activeWalk;
}

export async function setActiveWalkMode(mode = 'tracking') {
  const walk = state.activeWalk;
  if (!walk || !['tracking', 'round-trip', 'point-to-point'].includes(mode)) return;
  walk.routeMode = mode;
  await persistWalkDraft();
  toast(mode === 'tracking' ? 'Continuing as an open tracking walk.' : `${mode === 'round-trip' ? 'Round trip' : 'Point-to-point'} mode noted for this walk.`);
}

export async function recordPoiEncounter(poi, distance = null) {
  const walk = state.activeWalk;
  if (!walk || !poi?.id || walk.poiEncounters.some(({ poiId }) => poiId === String(poi.id))) return null;
  const timestamp = new Date().toISOString();
  const encounter = { poiId: String(poi.id), name: poi.name || 'Nearby place', timestamp, location: copyLocation(poi), distanceMeters: Number.isFinite(distance) ? Math.round(distance) : null };
  walk.poiEncounters.push(encounter);
  walk.associatedPlaceIds = [...new Set([...walk.associatedPlaceIds, String(poi.id)])];
  return recordWalkEvent('poi-encounter', encounter.location, { poiId: encounter.poiId, name: encounter.name, distanceMeters: encounter.distanceMeters }, timestamp, 'completed');
}

export async function recordWalkEvent(type, location, metadata = {}, timestamp = new Date().toISOString(), eventState = 'encountered') {
  const walk = state.activeWalk;
  if (!walk) return null;
  const event = createWalkEvent({ id: uid('walk-event'), walkId: walk.id, type, timestamp, location, state: eventState, metadata });
  if (eventState === 'completed') {
    event.endTime = timestamp;
    event.durationSeconds = event.durationSeconds || 0;
    event.immutable = true;
  }
  addEventToWalk(walk, event);
  await Promise.all([db.put('walk_events', event), persistWalkDraft()]);
  void renderArchive();
  return event;
}

async function completeEventById(id, endTime, metadata = {}) {
  const walk = state.activeWalk;
  const index = walk?.events?.findIndex((event) => event.id === id) ?? -1;
  if (index < 0) return null;
  const completed = completeWalkEvent(walk.events[index], endTime, metadata);
  walk.events[index] = completed;
  await db.put('walk_events', completed);
  return completed;
}

function beginGpsWatch() {
  stopGpsWatch();
  state.timerId = setInterval(() => { updateWalkDisplay(); void persistWalkDraft(); }, 1000);
  state.watchId = navigator.geolocation.watchPosition(
    (position) => handlePosition(position, state.activeWalk?.points.length === 0),
    () => { setStatus('Location connection paused'); toast('Location connection paused — your current route is still saved.'); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function stopGpsWatch() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  clearInterval(state.timerId);
  state.timerId = null;
}

async function persistWalkDraft() {
  if (!state.activeWalk) return;
  updateWalkDurations(state.activeWalk);
  await db.put('walk_drafts', { id: DRAFT_ID, updatedAt: new Date().toISOString(), walk: normalizeWalkArtifact(state.activeWalk) });
}

function renderWalkReview() {
  const walk = state.activeWalk;
  if (!walk) return;
  const summary = walkReviewSummary(walk);
  el('walkReviewDistance').textContent = `${formatDistance(summary.distanceMeters)} mi`;
  el('walkReviewElapsed').textContent = formatDuration(summary.elapsedDurationSeconds);
  el('walkReviewMoving').textContent = formatDuration(summary.movingDurationSeconds);
  el('walkReviewRouteStatus').textContent = summary.hasTrack ? `${summary.pointCount} recorded GPS points retained` : 'No accurate GPS points were available; the time and journal context are still retained.';
  const labels = { pause: 'Pause', return: 'Return', 'new-area': 'New area', slowdown: 'Slowdown', 'repeated-segment': 'Repeated segment', 'photo-stop': 'Photo stop', 'poi-encounter': 'POI encounter' };
  el('walkReviewEvents').innerHTML = summary.eventCount
    ? walk.events.map((event) => `<li><strong>${escapeHtml(labels[event.type] || event.type)}</strong><span>${escapeHtml(new Date(event.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}${event.durationSeconds ? ` · ${escapeHtml(formatDuration(event.durationSeconds))}` : ''}</span></li>`).join('')
    : '<li><span>No automatic events — the recorded route is still the primary artifact.</span></li>';
  el('walkReviewContext').textContent = `${summary.poiEncounterCount} place encounter${summary.poiEncounterCount === 1 ? '' : 's'} · ${summary.observationCount} observation${summary.observationCount === 1 ? '' : 's'}`;
}

function resetActiveWalk() {
  stopGpsWatch();
  state.activeWalk = null;
  state.routeLine?.remove();
  state.routeLine = null;
  updateWalkDisplay();
  el('walkButton').innerHTML = '<img class="ui-icon ui-icon--small" src="./icons/activity.svg" alt="" /> Start walk';
  el('walkButton').classList.remove('walking');
  const pauseButton = el('pauseWalkButton');
  if (pauseButton) pauseButton.classList.add('hidden');
}

async function updatePersonalPlaceCandidates(walk) {
  const candidates = await db.all('personal_places');
  const signals = (walk.events || []).filter((event) => ['pause', 'return'].includes(event.type) && event.location);
  for (const signal of signals) {
    let place = candidates.find((candidate) => distanceMeters(candidate.location, signal.location) <= 35);
    if (!place) {
      place = { id: uid('personal-place'), name: null, state: 'candidate', location: copyLocation(signal.location), firstObservedAt: signal.timestamp, lastObservedAt: signal.timestamp, stopCount: 0, returnCount: 0, walkIds: [], private: true };
      candidates.push(place);
    }
    place.lastObservedAt = signal.timestamp;
    place.walkIds = [...new Set([...(place.walkIds || []), walk.id])];
    if (signal.type === 'pause') place.stopCount = (place.stopCount || 0) + 1;
    if (signal.type === 'return') place.returnCount = (place.returnCount || 0) + 1;
    place.fact = place.stopCount > 1 ? `You have stopped here ${place.stopCount} times.` : place.returnCount > 0 ? `You returned to this location during a recorded walk.` : 'You stopped here during a recorded walk.';
    await db.put('personal_places', place);
  }
}

function copyLocation(location) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return { lat: location.lat, lng: location.lng, ...(Number.isFinite(location.accuracy) ? { accuracy: location.accuracy } : {}) };
}
