// Local-first Room primitives. Public Rooms can later use the same contract
// without making private Rooms dependent on a database.
import db from './storage.js';
import { uid } from './utils.js';
import { openSheet } from './ui.js';

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

export async function openRoomForPlace(place) {
  if (!place?.id) return null;
  let room = await resolveRoom(place.id);
  if (!room) room = await saveRoom(createRoom({ placeId: place.id, type: inferRoomType(place), name: place.name || 'Place Room', geometry: place.geometry || null }));
  const title = document.getElementById('roomTitle');
  const type = document.getElementById('roomType');
  const body = document.getElementById('roomBody');
  if (title) title.textContent = room.name;
  if (type) type.textContent = `${room.type.replaceAll('-', ' ')} · ${room.visibility}`;
  if (body) body.textContent = room.visibility === 'private' ? 'This Room is private on this device. Add place-specific notes and audio here; publishing requires Field Edition.' : 'This Room is ready for place-specific experiences.';
  openSheet('roomSheet');
  return room;
}

function inferRoomType(place) {
  const tags = [...(place.tags || []), place.category, place.type].filter(Boolean).map(String);
  if (tags.some((tag) => /museum/i.test(tag))) return 'museum';
  if (tags.some((tag) => /garden/i.test(tag))) return 'garden';
  if (tags.some((tag) => /trail/i.test(tag))) return 'trail';
  if (tags.some((tag) => /park/i.test(tag))) return 'park';
  if (tags.some((tag) => /historic|heritage/i.test(tag))) return 'historic-site';
  return 'building';
}
