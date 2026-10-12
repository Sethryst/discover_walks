import db from './storage.js';
import { escapeHtml } from './utils.js';

export const JOURNAL_ROOM_ID = 'room:journal';

async function getJournalRoom() {
  let room = await db.get('rooms', JOURNAL_ROOM_ID);
  if (!room) {
    const now = new Date().toISOString();
    room = { id: JOURNAL_ROOM_ID, schemaVersion: 1, placeId: JOURNAL_ROOM_ID, type: 'neighborhood', name: 'Journal Room', visibility: 'private', data: { items: [], layout: 'grid', alignment: 'street-lines' }, audioStationIds: [], traces: [], createdAt: now, updatedAt: now };
    await db.put('rooms', room);
  }
  return room;
}

function snapshotPlace(place) {
  const geometry = place?.geometry?.coordinates;
  const location = place?.location || (Array.isArray(geometry) ? { lng: geometry[0], lat: geometry[1] } : null);
  return {
    id: String(place.id), name: String(place.name || place.title || 'Untitled place').trim().slice(0, 120),
    type: String(place.type || place.category || 'place').trim().slice(0, 60), category: String(place.category || place.type || 'place').trim().slice(0, 60),
    location: location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng)) ? { lat: Number(location.lat), lng: Number(location.lng) } : null,
    tags: Array.isArray(place.tags) ? place.tags.map(String).slice(0, 12) : [], note: String(place.notes || place.note || place.description || '').trim().slice(0, 280),
    source: Array.isArray(place.source) ? String(place.source[0] || '') : String(place.source || ''), addedAt: new Date().toISOString()
  };
}

export async function addPlaceToJournalRoom(place) {
  const room = await getJournalRoom();
  if (!place?.id) return { added: false, room };
  const items = Array.isArray(room.data?.items) ? room.data.items : [];
  if (items.some((item) => item.id === String(place.id))) return { added: false, room };
  const next = { ...room, data: { ...room.data, items: [...items, snapshotPlace(place)] }, updatedAt: new Date().toISOString() };
  await db.put('rooms', next);
  window.dispatchEvent(new CustomEvent('journal-room-changed'));
  return { added: true, room: next };
}

export async function removePlaceFromJournalRoom(placeId) {
  const room = await getJournalRoom();
  const items = (room.data?.items || []).filter((item) => item.id !== String(placeId));
  if (items.length === (room.data?.items || []).length) return room;
  const next = { ...room, data: { ...room.data, items }, updatedAt: new Date().toISOString() };
  await db.put('rooms', next);
  window.dispatchEvent(new CustomEvent('journal-room-changed'));
  return next;
}

export async function renderJournalRoom(target) {
  if (!target) return;
  const room = await getJournalRoom();
  const items = Array.isArray(room.data?.items) ? room.data.items : [];
  target.innerHTML = `<div class="journal-room-heading"><div><span class="sheet-kicker">PLACE COMPOSITION</span><h3>Journal Room</h3><p>Collect places here before arranging the page.</p></div><span class="journal-room-count">${items.length} place${items.length === 1 ? '' : 's'}</span></div>${items.length ? `<div class="journal-room-grid">${items.map((item, index) => `<article class="journal-room-card" style="--journal-card-index:${index}" data-journal-place="${escapeHtml(item.id)}"><div class="journal-room-card-top"><span class="journal-room-marker" aria-hidden="true">${index + 1}</span><button type="button" class="icon-button" data-journal-room-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)} from Journal Room">×</button></div><h4>${escapeHtml(item.name)}</h4><small>${escapeHtml(item.category || item.type || 'place')}${item.location ? ` · ${item.location.lat.toFixed(4)}, ${item.location.lng.toFixed(4)}` : ''}</small>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}${item.tags?.length ? `<div class="journal-room-tags">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}</article>`).join('')}</div>` : '<div class="journal-room-empty"><strong>Your place page starts here.</strong><p>Open a place, then choose “Add to Journal Room” to bring it into this grid.</p></div>'}<div class="journal-room-guide"><span aria-hidden="true">⌗</span><span><strong>Alignment guide ready</strong><small>Street lines and nearby details will become the next layer of the page.</small></span></div>`;
}

export function initJournalRoom() {
  if (initJournalRoom.bound) return;
  initJournalRoom.bound = true;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-journal-room-remove]');
    if (button) void removePlaceFromJournalRoom(button.dataset.journalRoomRemove);
  });
  window.addEventListener('journal-room-changed', () => void renderJournalRoom(document.getElementById('journalRoomPanel')));
  void renderJournalRoom(document.getElementById('journalRoomPanel'));
}
