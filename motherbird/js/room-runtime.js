// Local-first Room primitives. Public Rooms can later use the same contract
// without making private Rooms dependent on a database.
import db from './storage.js';
import { uid } from './utils.js';

export const ROOM_TYPES = Object.freeze(['building', 'park', 'trail', 'garden', 'historic-site', 'museum', 'neighborhood']);
export const ROOM_VISIBILITY = Object.freeze(['private', 'bundled', 'public']);

export function createRoom({ placeId, type = 'building', name = '', geometry = null, visibility = 'private', data = {} } = {}) {
  if (!placeId) throw new Error('A Room needs a place id.');
  if (!ROOM_TYPES.includes(type)) throw new Error(`Unsupported Room type: ${type}`);
  return { id: uid('room'), schemaVersion: 1, placeId: String(placeId), type, name: String(name).trim().slice(0, 120), geometry, visibility: ROOM_VISIBILITY.includes(visibility) ? visibility : 'private', data, audioStationIds: [], traces: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export async function saveRoom(room) {
  const next = { ...room, updatedAt: new Date().toISOString(), audioStationIds: [...new Set(room.audioStationIds || [])] };
  await db.put('rooms', next);
  return next;
}

export async function resolveRoom(placeId) {
  const rooms = await db.all('rooms');
  return rooms.find((room) => room.placeId === String(placeId) && room.visibility !== 'public') || null;
}

export function canPublishRoom(room, { fieldEdition = false } = {}) {
  return Boolean(fieldEdition && room?.visibility === 'public');
}

export function addRoomAudioStation(room, stationId) {
  return { ...room, audioStationIds: [...new Set([...(room.audioStationIds || []), String(stationId)])], updatedAt: new Date().toISOString() };
}
