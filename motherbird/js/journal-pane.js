import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml } from './utils.js';
import { displayPoiName, isOsmPoi, isVisiblePoi, poiObeysMapLights } from './poi.js';

const SHEET_STATES = ['collapsed', 'half', 'expanded'];

export function setJournalSheetState(next = 'half') {
  const journal = el('persistentJournal');
  if (!journal || !SHEET_STATES.includes(next)) return;
  journal.dataset.sheetState = next;
  el('journalDragHandle')?.setAttribute('aria-expanded', String(next !== 'collapsed'));
  document.body.classList.toggle('journal-sheet-expanded', next === 'expanded');
  window.setTimeout(() => state.map?.invalidateSize({ pan: false }), 220);
}

export function collapseJournalSheet() {
  if (window.matchMedia('(max-width: 760px)').matches) setJournalSheetState('collapsed');
}

export function renderNearbyPlaces() {
  const target = el('nearbyList');
  if (!target) return [];
  const center = state.currentPosition || state.lastPosition || (state.map ? { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng } : null);
  const candidates = center ? (state.cityPois[state.activeCity] || [])
    .filter((poi) => isVisiblePoi(poi) && poiObeysMapLights(poi) && Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .map((poi) => ({ poi, distance: distanceMeters(center, poi) }))
    .sort((a, b) => a.distance - b.distance) : [];
  const places = contextualNearbyPlaces(candidates);
  const radius = Number(state.settings.defaultGeofenceRadiusMeters || 50);
  const nearby = candidates.filter(({ distance }) => distance <= radius).length;
  const origin = state.currentPosition ? 'current fix' : state.lastPosition ? 'last fix' : 'map center; GPS is off';
  const check = `<p class="nearby-radius-check">${nearby} places within your ${radius} m Locate radius · ${origin}.</p>`;
  target.innerHTML = check + (places.length ? places.map(({ poi, distance }) => `<article class="nearby-card"><span class="nearby-marker">${(poi.tags || []).includes('history') ? '✦' : '⌁'}</span><div><strong>${escapeHtml(displayPoiName(poi))}</strong><small>${distance < 1000 ? `${Math.round(distance)} m away` : `${(distance / 1609.344).toFixed(1)} mi away`}${isOsmPoi(poi) ? ' · OpenStreetMap' : ''}</small><div><button type="button" data-nearby-view="${escapeHtml(poi.id)}">View on map</button><button type="button" data-nearby-round-trip="${escapeHtml(poi.id)}">Create round trip</button><button type="button" data-nearby-remember="${escapeHtml(poi.id)}">Remember</button></div></div></article>`).join('') : '<div class="empty-state"><strong>No nearby places loaded.</strong>Try another region or move the map to a place you want to explore.</div>');
  return places;
}

export function contextualNearbyPlaces(candidates, limit = 6) {
  const selected = [];
  let osmCount = 0;
  for (const candidate of candidates) {
    if (isOsmPoi(candidate.poi) && osmCount >= Math.ceil(limit / 2)) continue;
    selected.push(candidate);
    if (isOsmPoi(candidate.poi)) osmCount += 1;
    if (selected.length >= limit) break;
  }
  return selected;
}

export function initJournalPane() {
  const handle = el('journalDragHandle');
  const journal = el('persistentJournal');
  if (!handle || !journal) return;
  let startY = 0;
  let dragging = false;

  handle.addEventListener('click', () => {
    if (dragging) return;
    const index = SHEET_STATES.indexOf(journal.dataset.sheetState || 'half');
    setJournalSheetState(SHEET_STATES[(index + 1) % SHEET_STATES.length]);
  });
  handle.addEventListener('pointerdown', (event) => {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    startY = event.clientY; dragging = false; handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 6) dragging = true;
    journal.style.setProperty('--journal-drag-y', `${Math.max(-90, Math.min(90, delta))}px`);
  });
  handle.addEventListener('pointerup', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    const delta = event.clientY - startY;
    journal.style.removeProperty('--journal-drag-y');
    const index = SHEET_STATES.indexOf(journal.dataset.sheetState || 'half');
    if (delta > 45) setJournalSheetState(SHEET_STATES[Math.max(0, index - 1)]);
    else if (delta < -45) setJournalSheetState(SHEET_STATES[Math.min(SHEET_STATES.length - 1, index + 1)]);
    window.setTimeout(() => { dragging = false; }, 0);
  });

  window.addEventListener('map-context-requested', collapseJournalSheet);
  el('journalCollapseButton')?.addEventListener('click', () => setJournalSheetState('collapsed'));
  el('journalExpandButton')?.addEventListener('click', () => setJournalSheetState('expanded'));
}
