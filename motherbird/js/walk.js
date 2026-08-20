import { renderUserLocation } from './map.js';
import { distanceMeters } from './geo.js';
import { state } from './state.js';
import {
  MAX_GPS_ACCURACY_METERS,
  MAX_WALK_SPEED_MPS,
  POINTS_PER_MILE,
  STREAK_BONUS_PER_DAY
} from './constants.js';
import { el, uid, formatDuration, formatDistance, dayKey, previousDayKey } from './utils.js';
import { checkGeofences } from './geofence.js';
import { toast, setStatus, openJournal } from './ui.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { renderArchive } from './archive.js';

export function addWalkPoint(point) {
  if (!state.activeWalk || state.activeWalk.paused) return;
  if (!Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS) return;
  const points = state.activeWalk.points;
  const last = points.at(-1);
  const lastRaw = state.activeWalk.lastRawPoint;
  const now = Date.now();
  if (lastRaw) {
    const elapsedSeconds = Math.max(1, (now - lastRaw.capturedAtMs) / 1000);
    if (distanceMeters(lastRaw, point) / elapsedSeconds > MAX_WALK_SPEED_MPS) return;
  }
  if (last && distanceMeters(last, point) < 7) return;
  const samples = [...points.slice(-2), point];
  const smoothed = { lat: samples.reduce((sum, sample) => sum + sample.lat, 0) / samples.length, lng: samples.reduce((sum, sample) => sum + sample.lng, 0) / samples.length, accuracy: point.accuracy, capturedAt: new Date(now).toISOString() };
  state.activeWalk.lastRawPoint = { ...point, capturedAtMs: now };
  state.activeWalk.points.push(smoothed);
  state.activeWalk.distanceMeters += last ? distanceMeters(last, smoothed) : 0;
  if (!state.routeLine) state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  state.routeLine.addLatLng([smoothed.lat, smoothed.lng]);
  updateWalkDisplay();
}
export function updateWalkDisplay() {
  const walk = state.activeWalk;
  if (!walk) { el('walkDuration').textContent = '00:00'; el('walkDistance').textContent = '0.00'; el('walkPoints').textContent = '0'; el('activeRouteButton').classList.add('hidden'); el('walkingTopbar').classList.add('hidden'); return; }
  const pausedNow = walk.pausedAt ? Date.now() - new Date(walk.pausedAt).getTime() : 0;
  walk.durationSeconds = Math.max(0, Math.floor((Date.now() - new Date(walk.startedAt).getTime() - (walk.pausedMilliseconds || 0) - pausedNow) / 1000));
  el('walkDuration').textContent = formatDuration(walk.durationSeconds);
  el('walkDistance').textContent = formatDistance(walk.distanceMeters);
  el('walkPoints').textContent = calculateWalkAward(walk).total;
  const distance = formatDistance(walk.distanceMeters);
  const duration = formatDuration(walk.durationSeconds);
  el('activeRouteButton').classList.remove('hidden');
  el('activeRouteSummary').textContent = `${distance} mi · ${duration}`;
  el('routeSheetDistance').textContent = `${distance} mi`;
  el('routeSheetDuration').textContent = `${duration} elapsed`;
  el('routePauseButton').textContent = walk.paused ? 'Resume' : 'Pause';
  el('walkingTopbar').classList.remove('hidden');
  el('walkingTopbarStatus').textContent = walk.paused ? 'Walk paused — your route is saved' : `Recording · ${distance} mi · ${duration}`;
}
export function handlePosition(position, shouldPan = false) {
  const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
  renderUserLocation(point, shouldPan);
  const weakSignal = !Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS;
  if (weakSignal) { setStatus(`GPS signal weak (${Math.round(point.accuracy || 0)} m) - route not updated`); return; }
  setStatus(state.activeWalk ? (state.activeWalk.paused ? 'Walk paused' : 'Recording your walk') : 'Location found', Boolean(state.activeWalk && !state.activeWalk.paused));
  if (state.activeWalk) addWalkPoint(point);
  checkGeofences(point);
}
export function getCurrentLocation() {
  if (!navigator.geolocation) { toast('This browser does not support location. Try the history preview instead.'); return; }
  setStatus('Finding your location...', true);
  navigator.geolocation.getCurrentPosition((position) => handlePosition(position, true), (error) => { setStatus('Location unavailable'); toast(error.code === 1 ? 'Location permission is needed to detect nearby places.' : 'Could not get a location. Check your signal and try again.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
}
export function ensurePauseButton() {
  let button = el('pauseWalkButton');
  if (!button) { button = document.createElement('button'); button.id = 'pauseWalkButton'; button.type = 'button'; button.className = 'secondary-button'; el('walkButton').before(button); button.addEventListener('click', togglePauseWalk); }
  button.classList.remove('hidden'); button.textContent = 'Pause';
}
export function pauseWalk() { const walk = state.activeWalk; if (!walk) return; walk.paused = true; walk.pausedAt = new Date().toISOString(); el('pauseWalkButton').textContent = 'Resume'; setStatus('Walk paused'); updateWalkDisplay(); }
export function resumeWalk() { const walk = state.activeWalk; if (!walk || !walk.paused) return; walk.pausedMilliseconds += Date.now() - new Date(walk.pausedAt).getTime(); walk.paused = false; walk.pausedAt = null; walk.lastRawPoint = null; el('pauseWalkButton').textContent = 'Pause'; setStatus('Recording your walk', true); updateWalkDisplay(); }
export function togglePauseWalk() { if (state.activeWalk?.paused) resumeWalk(); else pauseWalk(); }
export function startWalk() {
  if (!navigator.geolocation) { toast('Location is not supported in this browser.'); return; }
  state.activeWalk = { id: uid('walk'), city: state.activeCity, startedAt: new Date().toISOString(), endedAt: null, durationSeconds: 0, distanceMeters: 0, points: [], journal: null, paused: false, pausedAt: null, pausedMilliseconds: 0, lastRawPoint: null, discoveryCount: 0 };
  ensurePauseButton(); state.routeLine?.remove(); state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  el('walkButton').textContent = 'End walk'; el('walkButton').classList.add('walking'); setStatus('Recording your walk', true);
  updateWalkDisplay();
  state.timerId = setInterval(updateWalkDisplay, 1000);
  state.watchId = navigator.geolocation.watchPosition((position) => handlePosition(position, state.activeWalk.points.length === 0), () => { setStatus('Location connection paused'); toast('Location connection paused - your current route is still saved.'); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  getCurrentLocation();
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
  if (!state.activeWalk) return;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null; clearInterval(state.timerId); state.timerId = null; updateWalkDisplay();
  const finished = { ...state.activeWalk, endedAt: new Date().toISOString(), points: [...state.activeWalk.points] };
  const award = await updateProfile((profile) => { const score = calculateWalkAward(finished, profile); profile.totalPoints += score.total; profile.walksCompleted += 1; profile.milesTotal += score.miles; if (score.firstWalkToday) { profile.streakDays = score.nextStreak; profile.lastWalkDate = score.date; } return score; });
  finished.pointsAwarded = award.total; await db.put('walks', finished); state.activeWalk = null; updateWalkDisplay();
  el('walkButton').textContent = 'Start walk'; el('walkButton').classList.remove('walking'); const pauseButton = el('pauseWalkButton'); if (pauseButton) pauseButton.classList.add('hidden');
  setStatus('Walk saved locally'); toast(`Walk saved - +${award.total} points.`); renderArchive(); openJournal(finished.id);
}


