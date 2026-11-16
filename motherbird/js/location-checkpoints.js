import { state } from './state.js';
import db from './storage.js';
import { distanceMeters } from './geo.js';
import { normalizeWalkArtifact } from './walk-artifact.js';

const CHECKPOINT_WALK_ID = 'user-location-checkpoints';
const DUPLICATE_RADIUS_METERS = 100;
let pendingCheckpoint = null;

function validLocation(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
    && Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180;
}

export async function recordLocationCheckpoint(position) {
  if (pendingCheckpoint) return pendingCheckpoint;
  pendingCheckpoint = recordLocationCheckpointInternal(position);
  try { return await pendingCheckpoint; } finally { pendingCheckpoint = null; }
}

async function recordLocationCheckpointInternal(position) {
  const point = { lat: Number(position?.coords?.latitude), lng: Number(position?.coords?.longitude) };
  if (!validLocation(point)) return null;
  const moments = await db.all('moments');
  const existing = moments.filter((moment) => moment.location && moment.locationCheckpoint)
    .find((moment) => distanceMeters(point, moment.location) <= DUPLICATE_RADIUS_METERS);
  if (existing) return existing;
  const checkpoints = moments.filter((moment) => moment.locationCheckpoint);
  const number = checkpoints.length + 1;
  const now = new Date().toISOString();
  const checkpointId = `location-checkpoint:${crypto.randomUUID()}`;
  const moment = { id: checkpointId, type: 'journal', title: `Point ${number}`, note: 'Location checkpoint logged automatically from the current map position.', location: point, locationCheckpoint: true, checkpointNumber: number, city: state.activeCity, createdAt: now, updatedAt: now };
  await db.put('moments', moment);
  const saved = await db.get('walks', CHECKPOINT_WALK_ID);
  const walk = normalizeWalkArtifact(saved || { id: CHECKPOINT_WALK_ID, city: state.activeCity, startedAt: now, endedAt: now, recordingStatus: 'completed', saved: true, title: 'Logged locations', points: [] });
  walk.title = 'Logged locations'; walk.recordingStatus = 'completed'; walk.saved = true; walk.endedAt = now;
  walk.points = [...(walk.points || []), { ...point, timestamp: now }]; walk.startLocation ||= point; walk.endLocation = point;
  walk.momentIds = [...new Set([...(walk.momentIds || []), checkpointId])];
  walk.distanceMeters = walk.points.slice(1).reduce((total, item, index) => total + distanceMeters(walk.points[index], item), 0);
  await db.put('walks', walk);
  state.walks = [...(state.walks || []).filter((item) => item.id !== CHECKPOINT_WALK_ID), walk];
  window.dispatchEvent(new CustomEvent('journal-data-changed'));
  window.dispatchEvent(new CustomEvent('location-checkpoints-changed', { detail: { walk, moment } }));
  return moment;
}
