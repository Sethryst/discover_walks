import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import db from './storage.js';
import { openSheet, toast } from './ui.js';

const FORMAT = 'walk-wildlife-birdnote-v1';
const MAX_POINTS = 5000;

export function normalizeBirdnote(value) {
  const note = typeof value === 'string' ? JSON.parse(value) : value;
  if (!note || note.format !== FORMAT || !note.to || !note.message || !Array.isArray(note.route?.coordinates)) throw new Error('This is not a valid Messenger Bird delivery.');
  if (note.message.length > 500 || note.to.length > 120 || note.route.coordinates.length < 2 || note.route.coordinates.length > MAX_POINTS) throw new Error('This delivery is outside the supported size.');
  const coordinates = note.route.coordinates.map((point) => {
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('This route contains invalid coordinates.');
    return [point[0], point[1]];
  });
  return { format: FORMAT, id: String(note.id || crypto.randomUUID()), to: String(note.to), message: String(note.message), sentAt: String(note.sentAt || ''), route: { title: String(note.route.title || 'A chosen route').slice(0, 120), coordinates }, attachments: [] };
}

function routeSources() {
  const options = [];
  for (const moment of state.localDrawings || []) {
    const geometry = moment.body?.geojson?.geometry;
    if (moment.type !== 'drawing' || geometry?.type !== 'LineString' || geometry.coordinates?.length < 2) continue;
    options.push({ id: `drawing:${moment.id}`, title: moment.title || 'Drawn route', coordinates: geometry.coordinates });
  }
  for (const walk of state.walks || []) {
    const coordinates = (walk.points || []).map((point) => [point.lng, point.lat]).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (coordinates.length > 1) options.push({ id: `walk:${walk.id}`, title: `Recorded walk · ${new Date(walk.startedAt || walk.createdAt || Date.now()).toLocaleDateString()}`, coordinates });
  }
  return options.filter((route) => route.coordinates.length <= MAX_POINTS);
}

function renderRoutePreview(route, target) {
  if (!target) return;
  if (!route) { target.innerHTML = '<span class="route-preview-empty">Choose one of your saved drawn routes or recorded walks.</span>'; return; }
  const points = route.coordinates;
  const lngs = points.map(([lng]) => lng), lats = points.map(([, lat]) => lat);
  const minX = Math.min(...lngs), maxX = Math.max(...lngs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const xSpan = maxX - minX || 1e-9, ySpan = maxY - minY || 1e-9;
  const path = points.map(([lng, lat], index) => `${index ? 'L' : 'M'} ${(8 + (lng - minX) / xSpan * 184).toFixed(1)} ${(72 - (lat - minY) / ySpan * 64).toFixed(1)}`).join(' ');
  target.innerHTML = `<svg viewBox="0 0 200 80" role="img" aria-label="Exact selected route preview"><path d="${path}" fill="none" stroke="#76558b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${8}" cy="${72 - (points[0][1] - minY) / ySpan * 64}" r="4" fill="#2d7259"/><circle cx="${192}" cy="${72 - (points.at(-1)[1] - minY) / ySpan * 64}" r="4" fill="#8b3a4a"/></svg>`;
}

async function refreshInbox() {
  const deliveries = state.settings.messengerDeliveries || [];
  const count = deliveries.filter((item) => !item.openedAt).length;
  const label = el('messengerInboxCount'); if (label) label.textContent = count ? `${count} new` : `${deliveries.length} saved`;
  const list = el('messengerInboxList');
  if (list) list.innerHTML = deliveries.length ? deliveries.slice().reverse().map((item) => `<button type="button" class="messenger-delivery-card" data-delivery-id="${escapeHtml(item.id)}"><span aria-hidden="true">🐦</span><span><strong>${escapeHtml(item.route.title)}</strong><small>For ${escapeHtml(item.to)} · ${item.openedAt ? 'Opened' : 'Waiting quietly'}</small></span></button>`).join('') : '<p class="empty-state">No deliveries yet. Open a .birdnote someone shared with you.</p>';
}

async function openDelivery(file) {
  const parsed = normalizeBirdnote(await file.text());
  const list = state.settings.messengerDeliveries || [];
  let delivery = list.find((item) => item.id === parsed.id);
  if (!delivery) { delivery = { ...parsed, receivedAt: new Date().toISOString(), openedAt: null }; state.settings.messengerDeliveries = [...list, delivery]; await db.put('settings', state.settings); }
  await refreshInbox();
  openSheet('messengerInboxSheet');
  await playDelivery(delivery);
}

async function playDelivery(delivery) {
  const coordinates = delivery.route.coordinates;
  const latlngs = coordinates.map(([lng, lat]) => [lat, lng]);
  state.map?.fitBounds?.(latlngs, { padding: [60, 60], maxZoom: 16, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  const line = globalThis.L?.polyline(latlngs, { color: '#76558b', weight: 5, opacity: .92, dashArray: '7 8', lineCap: 'round' });
  line?.addTo(state.map);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (line && !reduced) {
    for (let i = 2; i <= latlngs.length; i += Math.max(1, Math.ceil(latlngs.length / 80))) {
      line.setLatLngs(latlngs.slice(0, i));
      await new Promise((resolve) => setTimeout(resolve, 10000 / Math.min(80, latlngs.length - 1)));
    }
    line.setLatLngs(latlngs);
  }
  delivery.openedAt = new Date().toISOString();
  state.settings.messengerDeliveries = (state.settings.messengerDeliveries || []).map((item) => item.id === delivery.id ? delivery : item);
  await db.put('settings', state.settings); await refreshInbox();
  const card = document.createElement('article'); card.className = 'messenger-arrival';
  card.innerHTML = `<span aria-hidden="true">🐦</span><div><small>DELIVERED FROM ${escapeHtml(delivery.to)}</small><strong>${escapeHtml(delivery.message)}</strong><button type="button" aria-label="Dismiss delivery">×</button></div>`;
  document.body.append(card); card.querySelector('button').addEventListener('click', () => card.remove());
  window.setTimeout(() => card.remove(), 12000);
}

export function initMessengerBird() {
  const select = el('messengerRouteSelect');
  const form = el('messengerComposeForm');
  el('messengerComposeButton')?.addEventListener('click', () => {
    el('messengerBirdMenu')?.classList.add('hidden'); el('messengerBirdButton')?.setAttribute('aria-expanded', 'false');
    const routes = routeSources();
    select.innerHTML = routes.length ? `<option value="">Choose a route…</option>${routes.map((route) => `<option value="${escapeHtml(route.id)}">${escapeHtml(route.title)}</option>`).join('')}` : '<option value="">No saved route available</option>';
    el('messengerSendButton').disabled = !routes.length;
    renderRoutePreview(null, el('messengerRoutePreview'));
    el('messengerPreviewSummary').textContent = routes.length ? 'Choose a route to see the exact line and what will travel with it.' : 'Draw a line in Draw or finish a recorded walk first.';
    el('messengerComposeStatus').textContent = '';
    openSheet('messengerComposeSheet');
  });
  select?.addEventListener('change', () => {
    const route = routeSources().find((item) => item.id === select.value);
    renderRoutePreview(route, el('messengerRoutePreview'));
    el('messengerPreviewSummary').textContent = route ? `${route.title} · ${route.coordinates.length} route points · shown above exactly as selected.` : 'Select a route to preview what will be shared.';
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const route = routeSources().find((item) => item.id === select.value);
    const to = el('messengerRecipient').value.trim(), message = el('messengerNote').value.trim();
    if (!route || !to || !message) return;
    const payload = normalizeBirdnote({ format: FORMAT, id: crypto.randomUUID(), to, message, sentAt: new Date().toISOString(), route: { title: route.title, coordinates: route.coordinates }, attachments: [] });
    const preview = `To: ${payload.to}\nNote: ${payload.message}\nRoute: ${payload.route.title} (${payload.route.coordinates.length} points)\nIncluded: the route and note only. No journal, media, or live location.`;
    if (!globalThis.confirm(`Review this delivery before sharing:\n\n${preview}\n\nContinue to your device's share sheet?`)) return;
    const file = new File([JSON.stringify(payload, null, 2)], `${payload.route.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'route'}.birdnote`, { type: 'application/vnd.walk-wildlife.birdnote+json' });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ title: `A route from ${payload.to}`, text: `${payload.message}\n\nOpen the attached .birdnote in Walk & Wildlife to receive the route.`, files: [file] });
      else { const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      el('messengerComposeStatus').textContent = 'Delivery package prepared. Choose a person in the share sheet, or send the downloaded .birdnote privately.';
    } catch (error) { if (error.name !== 'AbortError') el('messengerComposeStatus').textContent = 'The share sheet did not open. Your note and route remain on this device.'; }
  });
  el('messengerImportInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { await openDelivery(file); } catch (error) { toast(error.message || 'Could not open this delivery.'); }
  });
  el('messengerInboxList')?.addEventListener('click', async (event) => {
    const item = (state.settings.messengerDeliveries || []).find((entry) => entry.id === event.target.closest('[data-delivery-id]')?.dataset.deliveryId);
    if (item) await playDelivery(item);
  });
  void refreshInbox();
}
