import db from './storage.js';
import { distanceMeters } from './geo.js';
import { createWalkArtifact, normalizeWalkArtifact, updateWalkDurations } from './walk-artifact.js';
import { buildObservationRecord } from './observation-model.js';
import { uid } from './utils.js';

export const WATCH_DRAFT_ID = 'active-walk';
const MAX_ACCURACY_METERS = 80;
const MAX_WALK_SPEED_MPS = 15;

function safeLocation(location) {
  const lat = Number(location?.lat ?? location?.latitude);
  const lng = Number(location?.lng ?? location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, ...(Number.isFinite(Number(location?.accuracy)) ? { accuracy: Number(location.accuracy) } : {}) };
}

async function persistWalk(walk) {
  updateWalkDurations(walk);
  await db.put('walk_drafts', { id: WATCH_DRAFT_ID, updatedAt: new Date().toISOString(), walk: normalizeWalkArtifact(walk) });
  return walk;
}

export async function readWatchSession() {
  const [draft, places, observations, settings] = await Promise.all([
    db.get('walk_drafts', WATCH_DRAFT_ID),
    db.all('personal_places'),
    db.all('observations'),
    db.get('settings', 'app-settings')
  ]);
  const walk = draft?.walk && ['recording', 'stopped'].includes(draft.walk.recordingStatus) ? normalizeWalkArtifact(draft.walk) : null;
  if (walk) updateWalkDurations(walk);
  return { walk, places, observations, settings };
}

export async function startWatchWalk({ city = 'fairfax', location = null, now = new Date().toISOString() } = {}) {
  const existing = await db.get('walk_drafts', WATCH_DRAFT_ID);
  if (existing?.walk && ['recording', 'stopped'].includes(existing.walk.recordingStatus)) return normalizeWalkArtifact(existing.walk);
  const point = safeLocation(location);
  const walk = createWalkArtifact({ id: uid('walk'), city, startedAt: now, routeMode: 'tracking' });
  walk.captureSource = 'watch';
  if (point) {
    const captured = { ...point, capturedAt: now };
    walk.startLocation = point;
    walk.endLocation = point;
    walk.points.push(captured);
    walk.lastRawPoint = { ...point, capturedAtMs: new Date(now).getTime() };
  }
  return persistWalk(walk);
}

export async function appendWatchPosition(walk, location, capturedAtMs = Date.now()) {
  if (!walk || walk.paused || walk.recordingStatus !== 'recording') return walk;
  const point = safeLocation(location);
  if (!point || (Number.isFinite(point.accuracy) && point.accuracy > MAX_ACCURACY_METERS)) return walk;
  const last = walk.points?.at(-1);
  const lastRaw = walk.lastRawPoint;
  if (lastRaw) {
    const seconds = Math.max(1, (capturedAtMs - Number(lastRaw.capturedAtMs || capturedAtMs)) / 1000);
    if (distanceMeters(lastRaw, point) / seconds > MAX_WALK_SPEED_MPS) return walk;
  }
  walk.lastRawPoint = { ...point, capturedAtMs };
  if (last && distanceMeters(last, point) < 7) return persistWalk(walk);
  const capturedAt = new Date(capturedAtMs).toISOString();
  const next = { ...point, capturedAt };
  walk.points ||= [];
  walk.distanceMeters = Number(walk.distanceMeters) || 0;
  if (last) walk.distanceMeters += distanceMeters(last, next);
  walk.points.push(next);
  walk.startLocation ||= safeLocation(next);
  walk.endLocation = safeLocation(next);
  walk.lastMovementAt = capturedAt;
  return persistWalk(walk);
}

export async function toggleWatchPause(walk, now = new Date().toISOString()) {
  if (!walk || walk.recordingStatus !== 'recording') return walk;
  if (walk.paused) {
    walk.pausedMilliseconds = (Number(walk.pausedMilliseconds) || 0) + Math.max(0, Date.now() - new Date(walk.pausedAt || now).getTime());
    walk.paused = false;
    walk.pausedAt = null;
    walk.lastRawPoint = null;
  } else {
    walk.paused = true;
    walk.pausedAt = now;
  }
  return persistWalk(walk);
}

export async function finishWatchWalk(walk, location = null, now = new Date().toISOString()) {
  if (!walk || walk.recordingStatus !== 'recording') return walk;
  walk.paused = false;
  walk.pausedAt = null;
  walk.endedAt = now;
  walk.endLocation = safeLocation(location) || safeLocation(walk.points?.at(-1)) || walk.endLocation;
  walk.recordingStatus = 'stopped';
  updateWalkDurations(walk, new Date(now).getTime());
  return persistWalk(walk);
}

const QUICK_CAPTURE = Object.freeze({
  observation: { title: 'Quick observation', category: 'other', icon: 'eye', personalTags: ['watch'] },
  history: { title: 'History to revisit', category: 'history', icon: 'book-open', personalTags: ['watch', 'history'] }
});

export async function saveWatchCapture(kind, { location, walk = null, city = 'fairfax', now = new Date().toISOString() } = {}) {
  const point = safeLocation(location) || safeLocation(walk?.endLocation) || safeLocation(walk?.points?.at(-1));
  if (!point) throw new Error('Location is needed for a quick capture.');
  if (kind === 'place') {
    const place = {
      id: uid('personal-place'),
      name: 'Saved from watch',
      address: '',
      location: point,
      categoryId: null,
      notes: '',
      photos: [],
      added: now,
      updatedAt: now,
      source: 'watch_quick_capture',
      state: 'saved',
      private: true,
      needsRefinement: true
    };
    await db.put('personal_places', place);
    return place;
  }
  const template = QUICK_CAPTURE[kind] || QUICK_CAPTURE.observation;
  const observation = {
    ...buildObservationRecord({
      id: uid('observation'),
      city,
      category: template.category,
      title: template.title,
      personalTags: template.personalTags,
      icon: template.icon,
      location: point,
      walkId: walk?.id || null,
      createdAt: now
    }),
    captureSource: 'watch',
    needsRefinement: true,
    pointsAwarded: 0
  };
  await db.put('observations', observation);
  if (walk) {
    walk.observationIds = [...new Set([...(walk.observationIds || []), observation.id])];
    await persistWalk(walk);
  }
  return observation;
}

export function nearbyWatchPlaces(places = [], location = null, limit = 3) {
  const point = safeLocation(location);
  if (!point) return [];
  return places
    .filter((place) => place?.state === 'saved' && safeLocation(place.location))
    .map((place) => ({ ...place, distanceMeters: distanceMeters(point, place.location) }))
    .filter((place) => place.distanceMeters <= 1609.344)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}
