import { state } from './state.js';
import db from './storage.js';
import { el, escapeHtml } from './utils.js';
import { ensureSealSession, requireOnlineSession, reportOnlineError } from './online-pane.js';
import { base64url, unbase64url, importSealKey, sealJson, openSealedJson } from './cloud-journal.js';
import { renderArchive } from './archive.js';

let active = null, pollTimer = null, polling = false;
async function digestToken(token) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function sortFriendTickets(tickets) {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return [...byId.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t) || a.id.localeCompare(b.id));
}
export function validFriendBody(kind, body) {
  if (!body || typeof body !== 'object') return false;
  const allowed = { note: ['text'], pin: ['name', 'location', 'category'], draw: ['coordinates'] }[kind] || [];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return false;
  if (kind === 'note') return typeof body.text === 'string' && body.text.trim().length > 0 && body.text.length <= 12000;
  if (kind === 'pin') return typeof body.name === 'string' && body.name.length <= 80 && Number.isFinite(body.location?.lat) && Math.abs(body.location.lat) <= 90 && Number.isFinite(body.location?.lng) && Math.abs(body.location.lng) <= 180;
  if (kind === 'draw') return Array.isArray(body.coordinates) && body.coordinates.length > 1 && body.coordinates.length <= 20000 && body.coordinates.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Math.abs(p[0]) <= 90 && Number.isFinite(p[1]) && Math.abs(p[1]) <= 180);
  return false;
}
function status(message) { if (el('friendWalkStatus')) el('friendWalkStatus').textContent = message; }
async function rememberActive(id, rawKey, ownerId) {
  const personal = await ensureSealSession();
  const wrap = await sealJson({ id, key: base64url(rawKey), ownerId }, personal.key, `friend-key:${personal.ownerId}`);
  await db.put('settings', { id: 'friend-walk-active', userId: personal.ownerId, wrap });
  return wrap;
}
async function activate(id, key, ownerId) {
  active = { id, key, ownerId, userId: state.online.session.user.id, tickets: [] }; state.friendWalk = { id, ownerId };
  el('friendWalkActiveControls')?.classList.remove('hidden');
  clearInterval(pollTimer); pollTimer = setInterval(() => void pollFriendWalk().catch(reportOnlineError), 15000);
  await pollFriendWalk();
}
export async function startFriendWalk() {
  const personal = await ensureSealSession();
  const remembered = await db.get('settings', 'friend-walk-active');
  if (remembered?.userId === personal.ownerId) {
    const saved = await openSealedJson(remembered.wrap, personal.key, `friend-key:${personal.ownerId}`);
    await activate(saved.id, await importSealKey(unbase64url(saved.key)), saved.ownerId);
    return;
  }
  const id = crypto.randomUUID(), rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await importSealKey(rawKey), token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const inviteRaw = crypto.getRandomValues(new Uint8Array(32));
  const invite = { format: 'walk-wildlife-friend-invite-v1', id, token, inviteKey: base64url(inviteRaw), wrappedKey: await sealJson({ key: base64url(rawKey) }, await importSealKey(inviteRaw), `invite:${id}`) };
  const ownerWrap = await sealJson({ key: base64url(rawKey) }, personal.key, `friend-owner:${id}`);
  const sealedSession = await sealJson({ id, pack_id: state.regionAutomation?.activeRegionId || state.activeCity, createdAt: new Date().toISOString() }, key, `friend-session:${id}`);
  const { error } = await state.online.client.rpc('create_friend_walk', { session_id: id, invite_hash: await digestToken(token), sealed_session: sealedSession, owner_wrap: ownerWrap });
  if (error) throw error;
  await rememberActive(id, rawKey, personal.ownerId);
  el('friendWalkInvite').value = JSON.stringify(invite);
  el('friendWalkInvite').classList.remove('hidden');
  await activate(id, key, personal.ownerId);
  status('Friend walk ready. Share the invite privately; it grants access to this walk.');
}
export async function joinFriendWalk(input) {
  const invite = typeof input === 'string' ? JSON.parse(input) : input;
  if (invite?.format !== 'walk-wildlife-friend-invite-v1' || !/^[0-9a-f-]{36}$/i.test(invite.id || '') || !invite.token) throw new Error('Invalid friend-walk invite.');
  await requireOnlineSession();
  const unwrapped = await openSealedJson(invite.wrappedKey, await importSealKey(unbase64url(invite.inviteKey)), `invite:${invite.id}`);
  const raw = unbase64url(unwrapped.key), key = await importSealKey(raw);
  const { data, error } = await state.online.client.rpc('join_friend_walk', { session_id: invite.id, invite_token: invite.token });
  if (error) throw error;
  const ownerId = data?.owner_id || data?.[0]?.owner_id;
  if (!ownerId) throw new Error('The friend walk is unavailable or expired.');
  await rememberActive(invite.id, raw, ownerId);
  await activate(invite.id, key, ownerId);
}
export async function addFriendTicket(kind, body) {
  if (!active) throw new Error('Start or join a friend walk first.');
  if (!validFriendBody(kind, body)) throw new Error('Invalid friend-walk note, drawing, or pin.');
  const ticket = { id: crypto.randomUUID(), t: new Date().toISOString(), user: state.online.session.user.id, kind, body };
  const ciphertext = await sealJson(ticket, active.key, `friend-ticket:${active.id}:${ticket.id}`);
  const item = { id: `friend-outbox:${ticket.id}`, sessionId: active.id, ticketId: ticket.id, ciphertext };
  await db.put('settings', item);
  active.tickets = sortFriendTickets([...active.tickets, ticket]); renderTickets();
  if (navigator.onLine === false) { status('Ticket sealed on this device. It will send when you reconnect.'); return; }
  await flushTickets();
  await pollFriendWalk();
}
async function flushTickets() {
  if (!active || navigator.onLine === false) return;
  for (const item of (await db.all('settings')).filter((row) => row.id.startsWith('friend-outbox:') && row.sessionId === active.id)) {
    const { error } = await state.online.client.from('friend_walk_tickets').insert({ id: item.ticketId, session_id: active.id, user_id: state.online.session.user.id, ciphertext: item.ciphertext });
    if (error && error.code !== '23505') throw error;
    await db.remove('settings', item.id);
  }
}
function renderTickets() {
  if (!active) return;
  el('friendWalkTickets').innerHTML = active.tickets.map((ticket) => `<article><time>${escapeHtml(new Date(ticket.t).toLocaleTimeString())}</time><strong>${escapeHtml(ticket.kind)}</strong><p>${escapeHtml(ticket.kind === 'note' ? ticket.body.text : ticket.body.name || 'Shared map drawing')}</p></article>`).join('');
  window.dispatchEvent(new CustomEvent('friend-walk-tickets', { detail: active.tickets }));
}
export async function pollFriendWalk() {
  if (!active || polling || navigator.onLine === false) return;
  polling = true;
  try {
    const snapshot = active;
    const { data: session, error } = await state.online.client.from('friend_walk_sessions').select('owner_id,ciphertext,ended_at,expires_at').eq('id', snapshot.id).maybeSingle();
    if (error) throw error;
    if (!session) {
      const cached = (await db.all('settings')).filter((row) => row.sessionId === snapshot.id && row.id.startsWith('friend-cache:'));
      const tickets = await Promise.all(cached.map((row) => openSealedJson(row.ciphertext, snapshot.key, `friend-ticket:${snapshot.id}:${row.ticketId}`)));
      await mergeFriendTickets(snapshot.id, sortFriendTickets([...tickets, ...snapshot.tickets]));
      await clearActive(); status('Friend walk expired. Tickets already received were kept in your journal.'); return;
    }
    const metadata = await openSealedJson(session.ciphertext, snapshot.key, `friend-session:${snapshot.id}`);
    snapshot.packId = metadata.pack_id;
    // Keyset pagination avoids silently losing tickets after the REST row limit.
    let lastId = '', rows = [];
    while (true) {
      let query = state.online.client.from('friend_walk_tickets').select('id,user_id,ciphertext').eq('session_id', snapshot.id).order('id').limit(500);
      if (lastId) query = query.gt('id', lastId);
      const page = await query; if (page.error) throw page.error;
      rows.push(...page.data); if (page.data.length < 500) break; lastId = page.data.at(-1).id;
    }
    const tickets = [];
    for (const row of rows) {
      const ticket = await openSealedJson(row.ciphertext, snapshot.key, `friend-ticket:${snapshot.id}:${row.id}`);
      if (ticket.id !== row.id || ticket.user !== row.user_id || !validFriendBody(ticket.kind, ticket.body) || !Number.isFinite(Date.parse(ticket.t))) throw new Error('Invalid friend ticket.');
      await db.put('settings', { id: `friend-cache:${snapshot.id}:${row.id}`, sessionId: snapshot.id, ticketId: row.id, ciphertext: row.ciphertext });
      tickets.push(ticket);
    }
    if (active !== snapshot) return;
    active.tickets = sortFriendTickets(tickets); renderTickets();
    status(session.ended_at ? 'Walk ended. Merging tickets into your journal…' : `Friend walk · ${tickets.length} sealed tickets`);
    if (session.ended_at) {
      await mergeFriendTickets(snapshot.id, active.tickets);
      const ack = await state.online.client.rpc('acknowledge_friend_walk', { session_id: snapshot.id });
      if (ack.error) throw ack.error;
      await clearActive(); status('Friend walk saved to your journal. The session is closed.');
    }
  } finally { polling = false; }
}
export async function mergeFriendTickets(sessionId, tickets) {
  for (const ticket of sortFriendTickets(tickets)) {
    const id = `friend:${sessionId}:${ticket.id}`;
    if (await db.get('moments', id)) continue;
    await db.put('moments', { id, friendSessionId: sessionId, type: ticket.kind === 'draw' ? 'drawing' : ticket.kind === 'pin' ? 'friend-pin' : 'journal', title: `Friend walk · ${ticket.kind}`, note: ticket.kind === 'note' ? String(ticket.body.text || '') : ticket.body.name || 'Shared map drawing', body: ticket.body, createdAt: ticket.t, author: ticket.user, city: state.activeCity });
  }
  await renderArchive(); window.dispatchEvent(new CustomEvent('local-drawings-changed'));
}
async function clearActive() {
  clearInterval(pollTimer); pollTimer = null; active = null; state.friendWalk = null;
  await db.remove('settings', 'friend-walk-active');
  el('friendWalkActiveControls')?.classList.add('hidden'); el('friendWalkInvite')?.classList.add('hidden');
  window.dispatchEvent(new CustomEvent('friend-walk-tickets', { detail: [] }));
}
export async function endFriendWalk() {
  if (!active) return;
  if (navigator.onLine === false) throw new Error('Reconnect to end the friend walk. Your sealed tickets remain on this device.');
  await flushTickets();
  await pollFriendWalk();
  if (!active) return;
  if (active.ownerId !== state.online.session?.user.id) { await mergeFriendTickets(active.id, active.tickets); await clearActive(); status('Left friend walk. Tickets saved locally; the owner can end the session.'); return; }
  const { error } = await state.online.client.rpc('end_friend_walk', { session_id: active.id });
  if (error) throw error;
  await pollFriendWalk();
}
export function initFriendWalk() {
  el('startFriendWalkButton')?.addEventListener('click', () => void startFriendWalk().catch(reportOnlineError));
  el('joinFriendWalkForm')?.addEventListener('submit', (event) => { event.preventDefault(); void joinFriendWalk(el('joinFriendWalkInput').value).catch(reportOnlineError); });
  el('endFriendWalkButton')?.addEventListener('click', () => void endFriendWalk().catch(reportOnlineError));
  el('friendWalkNoteForm')?.addEventListener('submit', (event) => { event.preventDefault(); const text = el('friendWalkNoteInput').value.trim(); if (text) void addFriendTicket('note', { text }).then(() => { el('friendWalkNoteInput').value = ''; }).catch(reportOnlineError); });
  window.addEventListener('friend-walk-artifact', (event) => void addFriendTicket(event.detail.kind, event.detail.body).catch(reportOnlineError));
  window.addEventListener('walk-ended', () => { if (active) void endFriendWalk().catch(reportOnlineError); });
  window.addEventListener('online', () => { if (active) void flushTickets().then(pollFriendWalk).catch(reportOnlineError); });
  window.addEventListener('online-profile-changed', () => { if (active && active.userId !== state.online.session?.user.id) { clearInterval(pollTimer); pollTimer = null; active = null; state.friendWalk = null; window.dispatchEvent(new CustomEvent('friend-walk-tickets', { detail: [] })); el('friendWalkActiveControls')?.classList.add('hidden'); el('friendWalkInvite')?.classList.add('hidden'); } });
}
