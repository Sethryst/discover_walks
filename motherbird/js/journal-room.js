import db from './storage.js';
import { escapeHtml } from './utils.js';

export const JOURNAL_ROOM_ID = 'room:journal';

async function getJournalRoom() {
  let room = await db.get('rooms', JOURNAL_ROOM_ID);
  if (!room) {
    const now = new Date().toISOString();
    room = { id: JOURNAL_ROOM_ID, schemaVersion: 1, placeId: JOURNAL_ROOM_ID, type: 'neighborhood', name: 'Journal Room', visibility: 'private', data: { title: 'A place worth keeping', subtitle: 'Collect the places, details, and thoughts that belong together.', items: [], layout: 'grid', alignment: 'street-lines' }, audioStationIds: [], traces: [], createdAt: now, updatedAt: now };
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

function snapshotJournalNote(note) {
  return { id: `journal:${String(note.id)}`, sourceId: String(note.id), kind: 'journal', name: String(note.title || 'Journal note').trim().slice(0, 120), type: 'journal note', category: 'journal note', location: null, tags: ['journal'], note: String(note.note || '').trim().slice(0, 600), addedAt: new Date().toISOString() };
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

export async function addJournalNoteToJournalRoom(note) {
  const room = await getJournalRoom();
  if (!note?.id || !String(note.note || '').trim()) return { added: false, room };
  const items = Array.isArray(room.data?.items) ? room.data.items : [];
  const item = snapshotJournalNote(note);
  if (items.some((candidate) => candidate.id === item.id)) return { added: false, room };
  const next = { ...room, data: { ...room.data, items: [...items, item] }, updatedAt: new Date().toISOString() };
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

async function setJournalRoomLayout(layout) {
  const room = await getJournalRoom();
  const next = { ...room, data: { ...room.data, layout: layout === 'alignment' ? 'alignment' : 'grid' }, updatedAt: new Date().toISOString() };
  await db.put('rooms', next);
  window.dispatchEvent(new CustomEvent('journal-room-changed'));
}

async function updateJournalRoomMetadata(form) {
  const room = await getJournalRoom();
  const title = String(form.elements.title?.value || '').trim().slice(0, 120) || 'A place worth keeping';
  const subtitle = String(form.elements.subtitle?.value || '').trim().slice(0, 220);
  const next = { ...room, data: { ...room.data, title, subtitle }, updatedAt: new Date().toISOString() };
  await db.put('rooms', next);
  window.dispatchEvent(new CustomEvent('journal-room-changed'));
}

async function moveJournalRoomItem(itemId, direction) {
  const room = await getJournalRoom();
  const items = [...(room.data?.items || [])];
  const index = items.findIndex((item) => item.id === String(itemId));
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  await db.put('rooms', { ...room, data: { ...room.data, items }, updatedAt: new Date().toISOString() });
  window.dispatchEvent(new CustomEvent('journal-room-changed'));
}

function alignmentStyle(items) {
  const located = items.filter((item) => item.location && Number.isFinite(item.location.lat) && Number.isFinite(item.location.lng));
  if (!located.length) return { located, bounds: null };
  const lats = located.map((item) => item.location.lat); const lngs = located.map((item) => item.location.lng);
  const latPad = Math.max((Math.max(...lats) - Math.min(...lats)) * .14, .0008); const lngPad = Math.max((Math.max(...lngs) - Math.min(...lngs)) * .14, .0008);
  return { located, bounds: { minLat: Math.min(...lats) - latPad, maxLat: Math.max(...lats) + latPad, minLng: Math.min(...lngs) - lngPad, maxLng: Math.max(...lngs) + lngPad } };
}

export async function renderJournalRoom(target) {
  if (!target) return;
  const room = await getJournalRoom();
  const items = Array.isArray(room.data?.items) ? room.data.items : [];
  const layout = room.data?.layout === 'alignment' ? 'alignment' : 'grid';
  const { located, bounds } = alignmentStyle(items);
  const card = (item, index, spatial = false) => {
    const x = spatial && bounds && item.location ? ((item.location.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100 : null;
    const y = spatial && bounds && item.location ? (1 - ((item.location.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat))) * 100 : null;
    const style = spatial && x !== null ? `--journal-card-index:${index};--journal-x:${x.toFixed(2)}%;--journal-y:${y.toFixed(2)}%` : `--journal-card-index:${index}`;
    return `<article class="journal-room-card${spatial ? ' journal-room-card-spatial' : ''}" style="${style}" data-journal-place="${escapeHtml(item.id)}" data-journal-kind="${escapeHtml(item.kind || 'poi')}"><div class="journal-room-card-top"><span class="journal-room-marker" aria-hidden="true">${index + 1}</span><div class="journal-room-card-actions"><button type="button" class="icon-button" data-journal-room-move="${escapeHtml(item.id)}" data-journal-room-direction="-1" aria-label="Move ${escapeHtml(item.name)} earlier">↑</button><button type="button" class="icon-button" data-journal-room-move="${escapeHtml(item.id)}" data-journal-room-direction="1" aria-label="Move ${escapeHtml(item.name)} later">↓</button><button type="button" class="icon-button" data-journal-room-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)} from Journal Room">×</button></div></div><h4>${escapeHtml(item.name)}</h4><small>${escapeHtml(item.category || item.type || 'place')}${item.location ? ` · ${item.location.lat.toFixed(4)}, ${item.location.lng.toFixed(4)}` : ''}</small>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}${item.tags?.length ? `<div class="journal-room-tags">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}</article>`;
  };
  const unlocated = items.filter((item) => !item.location || !Number.isFinite(item.location.lat) || !Number.isFinite(item.location.lng));
  const locatedItems = items.filter((item) => item.location && Number.isFinite(item.location.lat) && Number.isFinite(item.location.lng));
  const content = items.length ? layout === 'alignment' ? `<div class="journal-room-alignment"><span class="journal-room-north">N</span><span class="journal-room-axis journal-room-axis-x"></span><span class="journal-room-axis journal-room-axis-y"></span>${locatedItems.map((item) => card(item, items.indexOf(item), true)).join('')}</div>${unlocated.length ? `<div class="journal-room-unlocated-grid">${unlocated.map((item) => card(item, items.indexOf(item))).join('')}</div>` : ''}` : `<div class="journal-room-grid">${items.map(card).join('')}</div>` : '<div class="journal-room-empty"><strong>Your place page starts here.</strong><p>Open a place, then choose “Add to Journal Room” to bring it into this grid.</p></div>';
  target.innerHTML = `<div class="journal-room-heading"><div><span class="sheet-kicker">PLACE COMPOSITION</span><h3>Journal Room</h3><p>Shape the page before you publish or share it.</p></div><span class="journal-room-count">${items.length} item${items.length === 1 ? '' : 's'}</span></div><form class="journal-room-meta" data-journal-room-meta><label>Page title<input name="title" maxlength="120" value="${escapeHtml(room.data?.title || 'A place worth keeping')}" /></label><label>Page subtitle<textarea name="subtitle" maxlength="220" rows="2">${escapeHtml(room.data?.subtitle || '')}</textarea></label><button type="submit" class="secondary-button">Save page details</button></form><div class="journal-room-layouts" role="group" aria-label="Journal Room layout"><button type="button" data-journal-layout="grid" class="${layout === 'grid' ? 'active' : ''}">Grid</button><button type="button" data-journal-layout="alignment" class="${layout === 'alignment' ? 'active' : ''}">Align by location</button></div>${content}<div class="journal-room-guide"><span aria-hidden="true">⌗</span><span><strong>${layout === 'alignment' ? 'North-up alignment' : 'Alignment guide ready'}</strong><small>${layout === 'alignment' ? 'Cards are placed from their coordinates; the next layer can add real street lines.' : 'Move cards into a reading order; location alignment stays available when you need it.'}</small></span></div>`;
}

export function initJournalRoom() {
  if (initJournalRoom.bound) return;
  initJournalRoom.bound = true;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-journal-room-remove]');
    if (button) void removePlaceFromJournalRoom(button.dataset.journalRoomRemove);
    const layout = event.target.closest('[data-journal-layout]');
    if (layout) void setJournalRoomLayout(layout.dataset.journalLayout);
    const move = event.target.closest('[data-journal-room-move]');
    if (move) void moveJournalRoomItem(move.dataset.journalRoomMove, Number(move.dataset.journalRoomDirection));
  });
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-journal-room-meta]');
    if (!form) return;
    event.preventDefault();
    void updateJournalRoomMetadata(form);
  });
  window.addEventListener('journal-room-changed', () => void renderJournalRoom(document.getElementById('journalRoomPanel')));
  void renderJournalRoom(document.getElementById('journalRoomPanel'));
}
