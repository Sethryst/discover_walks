import { distanceMeters } from './geo.js';

export const WALK_SCHEMA_VERSION = 2;
export const WALK_EVENT_TYPES = Object.freeze([
  'pause',
  'return',
  'new-area',
  'slowdown',
  'repeated-segment',
  'photo-stop',
  'poi-encounter'
]);

export function createWalkArtifact({ id, city, startedAt = new Date().toISOString(), routeMode = 'tracking', plannedRouteId = null } = {}) {
  if (!id) throw new Error('A walk id is required.');
  return {
    schemaVersion: WALK_SCHEMA_VERSION,
    id,
    city,
    startedAt,
    endedAt: null,
    elapsedDurationSeconds: 0,
    durationSeconds: 0,
    movingDurationSeconds: 0,
    distanceMeters: 0,
    points: [],
    startLocation: null,
    endLocation: null,
    recordingStatus: 'recording',
    saved: false,
    savedAt: null,
    routeMode,
    plannedRouteId,
    events: [],
    associatedPlaceIds: [],
    poiEncounters: [],
    observationIds: [],
    momentIds: [],
    photoIds: [],
    voiceNoteIds: [],
    paused: false,
    pausedAt: null,
    pausedMilliseconds: 0,
    lastRawPoint: null,
    lastMovementAt: startedAt,
    discoveryCount: 0,
    detectionState: {}
  };
}

export function normalizeWalkArtifact(walk = {}) {
  const startedAt = walk.startedAt || new Date().toISOString();
  const elapsed = Number(walk.elapsedDurationSeconds ?? walk.durationSeconds) || 0;
  return {
    ...createWalkArtifact({ id: walk.id || 'unknown-walk', city: walk.city, startedAt, routeMode: walk.routeMode || 'tracking', plannedRouteId: walk.plannedRouteId || null }),
    ...walk,
    schemaVersion: WALK_SCHEMA_VERSION,
    elapsedDurationSeconds: elapsed,
    durationSeconds: elapsed,
    movingDurationSeconds: Number(walk.movingDurationSeconds) || 0,
    points: Array.isArray(walk.points) ? walk.points : [],
    events: Array.isArray(walk.events) ? walk.events : [],
    associatedPlaceIds: uniqueStrings(walk.associatedPlaceIds),
    poiEncounters: Array.isArray(walk.poiEncounters) ? walk.poiEncounters : [],
    observationIds: uniqueStrings(walk.observationIds),
    momentIds: uniqueStrings(walk.momentIds),
    photoIds: uniqueStrings(walk.photoIds),
    voiceNoteIds: uniqueStrings(walk.voiceNoteIds),
    detectionState: walk.detectionState && typeof walk.detectionState === 'object' ? walk.detectionState : {}
  };
}

export function createWalkEvent({ id, walkId, type, timestamp = new Date().toISOString(), location = null, state = 'encountered', durationSeconds = null, metadata = {} } = {}) {
  if (!id || !walkId) throw new Error('Walk events require ids.');
  if (!WALK_EVENT_TYPES.includes(type)) throw new Error(`Unsupported walk event type: ${type}`);
  return {
    schemaVersion: 1,
    id,
    walkId,
    type,
    timestamp,
    startTime: timestamp,
    endTime: null,
    location: copyLocation(location),
    durationSeconds,
    state,
    metadata: { ...metadata },
    immutable: state === 'completed' || state === 'historical'
  };
}

export function addEventToWalk(walk, event) {
  if (!walk || !event || event.walkId !== walk.id) return walk;
  walk.events ||= [];
  if (!walk.events.some(({ id }) => id === event.id)) walk.events.push(event);
  return walk;
}

export function completeWalkEvent(event, endTime = new Date().toISOString(), metadata = {}) {
  const start = new Date(event.startTime || event.timestamp).getTime();
  const end = new Date(endTime).getTime();
  return {
    ...event,
    endTime,
    durationSeconds: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : event.durationSeconds,
    state: 'completed',
    immutable: true,
    metadata: { ...(event.metadata || {}), ...metadata }
  };
}

export function updateWalkDurations(walk, now = Date.now()) {
  if (!walk) return null;
  const start = new Date(walk.startedAt).getTime();
  const end = walk.endedAt ? new Date(walk.endedAt).getTime() : now;
  const pausedNow = walk.pausedAt && !walk.endedAt ? Math.max(0, end - new Date(walk.pausedAt).getTime()) : 0;
  const elapsed = Math.max(0, Math.floor((end - start) / 1000));
  walk.elapsedDurationSeconds = elapsed;
  // Keep the legacy field readable while callers migrate to explicit elapsed/moving time.
  walk.durationSeconds = elapsed;
  walk.activeDurationSeconds = Math.max(0, Math.floor((end - start - (walk.pausedMilliseconds || 0) - pausedNow) / 1000));
  return walk;
}

export function walkReviewSummary(walk) {
  const normalized = normalizeWalkArtifact(walk);
  return {
    id: normalized.id,
    distanceMeters: normalized.distanceMeters,
    elapsedDurationSeconds: normalized.elapsedDurationSeconds,
    movingDurationSeconds: normalized.movingDurationSeconds,
    pointCount: normalized.points.length,
    eventCount: normalized.events.length,
    observationCount: normalized.observationIds.length,
    poiEncounterCount: normalized.poiEncounters.length,
    hasTrack: normalized.points.length > 0,
    startLocation: normalized.startLocation || copyLocation(normalized.points[0]),
    endLocation: normalized.endLocation || copyLocation(normalized.points.at(-1))
  };
}

export function detectTrackEvents({ walk, point, previousPoint, knownTrackPoints = [], nowMs = Date.now() } = {}) {
  if (!walk || !point || !previousPoint) return [];
  const events = [];
  const pointTime = new Date(point.capturedAt || nowMs).getTime();
  const previousTime = new Date(previousPoint.capturedAt || pointTime - 1000).getTime();
  const seconds = Math.max(1, (pointTime - previousTime) / 1000);
  const speedMps = distanceMeters(previousPoint, point) / seconds;
  const detection = walk.detectionState ||= {};

  if (walk.points.length >= 4 && speedMps < 0.55 && nowMs - (detection.lastSlowdownAt || 0) > 120000) {
    detection.lastSlowdownAt = nowMs;
    events.push({ type: 'slowdown', timestamp: point.capturedAt, location: point, metadata: { measuredSpeedMps: round(speedMps, 2) } });
  }

  const oldPoint = walk.points.find((candidate) => {
    const captured = new Date(candidate.capturedAt || 0).getTime();
    return pointTime - captured >= 5 * 60 * 1000 && distanceMeters(candidate, point) <= 30;
  });
  if (oldPoint && nowMs - (detection.lastReturnAt || 0) > 5 * 60 * 1000) {
    detection.lastReturnAt = nowMs;
    events.push({ type: 'return', timestamp: point.capturedAt, location: point, metadata: { previousVisitAt: oldPoint.capturedAt, distanceFromPreviousMeters: round(distanceMeters(oldPoint, point), 1) } });
  }

  const recent = walk.points.slice(-4);
  const earlier = walk.points.slice(0, Math.max(0, walk.points.length - 12));
  const repeatedMatches = recent.filter((candidate) => earlier.some((old) => distanceMeters(candidate, old) <= 22)).length;
  if (recent.length === 4 && repeatedMatches >= 3 && nowMs - (detection.lastRepeatedSegmentAt || 0) > 5 * 60 * 1000) {
    detection.lastRepeatedSegmentAt = nowMs;
    events.push({ type: 'repeated-segment', timestamp: point.capturedAt, location: point, metadata: { matchingRecentPoints: repeatedMatches } });
  }

  if (walk.points.length >= 2 && knownTrackPoints.length && !knownTrackPoints.some((known) => distanceMeters(known, point) <= 80) && nowMs - (detection.lastNewAreaAt || 0) > 15 * 60 * 1000) {
    detection.lastNewAreaAt = nowMs;
    events.push({ type: 'new-area', timestamp: point.capturedAt, location: point, metadata: { thresholdMeters: 80 } });
  }

  return events;
}

export function attachArtifactToWalk(walk, { id, type } = {}) {
  if (!walk || !id) return walk;
  const field = type === 'observation' ? 'observationIds' : type === 'photo' ? 'photoIds' : type === 'voice-note' ? 'voiceNoteIds' : 'momentIds';
  walk[field] = uniqueStrings([...(walk[field] || []), id]);
  return walk;
}

function copyLocation(location) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return { lat: location.lat, lng: location.lng, ...(Number.isFinite(location.accuracy) ? { accuracy: location.accuracy } : {}) };
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
