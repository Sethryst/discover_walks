import db from './storage.js';
import { state } from './state.js';
import { escapeHtml, uid } from './utils.js';
import { generateTimeBasedPlan } from './planner.js';
import { renderFieldGuide } from './field-guide.js';

export const DEFAULT_WORKSPACE_ID = 'workspace:my-workspace';
const LINKABLE_STORES = [
  ['saved_routes', 'route'], ['walks', 'walk'], ['observations', 'observation'],
  ['geo_cypher_manifests', 'audio'], ['voice_notes', 'audio'], ['personal_places', 'place'], ['walk_plans', 'plan']
];

export function normalizeWorkspace(value = {}, now = new Date().toISOString()) {
  return {
    id: String(value.id || uid('workspace')),
    name: String(value.name || 'My Workspace').trim().slice(0, 80),
    description: String(value.description || 'A living field notebook for routes, places, and notes.').trim().slice(0, 300),
    createdAt: value.createdAt || now,
    updatedAt: now,
    icon: String(value.icon || 'book-open').slice(0, 40)
  };
}

export function normalizeWorkspaceLink(value = {}, now = new Date().toISOString()) {
  const workspaceId = String(value.workspaceId || DEFAULT_WORKSPACE_ID);
  const recordType = String(value.recordType || value.type || 'record');
  const recordId = String(value.recordId || value.id || '');
  return { id: String(value.id || `${workspaceId}:${recordType}:${recordId}`), workspaceId, recordType, recordId, createdAt: value.createdAt || now, updatedAt: now };
}

async function ensureWorkspace() {
  let workspace = state.workspaces.find((item) => item.id === DEFAULT_WORKSPACE_ID);
  if (!workspace) {
    workspace = normalizeWorkspace({ id: DEFAULT_WORKSPACE_ID, name: 'My Workspace' });
    await db.put('workspaces', workspace);
    state.workspaces = [...state.workspaces, workspace];
  }
  return workspace;
}

export async function linkWorkspaceRecord(workspaceId, recordType, recordId) {
  if (!workspaceId || !recordType || !recordId) return null;
  const id = `${workspaceId}:${recordType}:${recordId}`;
  if (state.workspaceLinks.some((link) => link.id === id)) return state.workspaceLinks.find((link) => link.id === id);
  const link = normalizeWorkspaceLink({ id, workspaceId, recordType, recordId });
  await db.put('workspace_links', link);
  state.workspaceLinks = [...state.workspaceLinks.filter((item) => item.id !== link.id), link];
  return link;
}

export async function linkSavedRecord(recordType, recordId) {
  const workspace = await ensureWorkspace();
  await linkWorkspaceRecord(workspace.id, recordType, recordId);
  if (state.activeWorkspaceId && state.activeWorkspaceId !== workspace.id) {
    await linkWorkspaceRecord(state.activeWorkspaceId, recordType, recordId);
  }
}

// Delete the original local record and its memberships together, never a copy.
export async function deleteWorkspaceRecord(recordType, recordId, sourceStore) {
  const allowedStores = recordType === 'annotation' || recordType === 'journal' ? ['moments']
    : LINKABLE_STORES.filter(([, type]) => type === recordType).map(([store]) => store);
  const stores = sourceStore ? allowedStores.filter((store) => store === sourceStore) : allowedStores;
  if (!stores.length || stores.length > 1) throw new Error('Select a specific workspace record.');
  const links = (await db.all('workspace_links')).filter((link) => link.recordType === recordType && link.recordId === recordId);
  const removals = Object.fromEntries(stores.map((store) => [store, [recordId]]));
  removals.workspace_links = links.map((link) => link.id);
  if (stores.includes('geo_cypher_manifests')) {
    removals.geo_cypher_audio = [recordId];
    removals.geo_cyphers = [recordId];
  }
  const updates = {};
  if (stores.includes('voice_notes')) {
    updates.moments = (await db.all('moments')).filter((moment) => moment.voiceIds?.includes(recordId)).map((moment) => ({ ...moment, voiceIds: moment.voiceIds.filter((id) => id !== recordId) }));
  }
  if (recordType === 'walk') removals.walk_events = (await db.all('walk_events')).filter((event) => event.walkId === recordId).map((event) => event.id);
  await db.putMany(updates, removals);
  state.workspaceLinks = state.workspaceLinks.filter((link) => !removals.workspace_links.includes(link.id));
  const stateKeys = { route: 'savedRoutes', walk: 'walks', observation: 'observations', audio: 'geoCyphers', place: 'personalPlaces', annotation: 'moments', journal: 'moments' };
  const key = stateKeys[recordType];
  if (key) state[key] = (state[key] || []).filter((record) => String(record.id) !== recordId);
  if (recordType === 'plan' && String(state.walkPlan?.id) === recordId) state.walkPlan = null;
  const events = { route: 'saved-routes-changed', walk: 'walks-changed', observation: 'observations-changed', audio: 'geo-cyphers-changed', place: 'personal-places-changed', annotation: 'local-drawings-changed', journal: 'journal-data-changed' };
  window.dispatchEvent(new CustomEvent(events[recordType]));
  window.dispatchEvent(new CustomEvent('workspace-changed'));
}

async function linkExistingRecords(workspaceId) {
  const additions = [];
  for (const [store, recordType] of LINKABLE_STORES) {
    const records = await db.all(store);
    for (const record of records) if (record?.id && !state.workspaceLinks.some((link) => link.workspaceId === workspaceId && link.recordType === recordType && link.recordId === String(record.id))) {
      additions.push(normalizeWorkspaceLink({ workspaceId, recordType, recordId: record.id }));
    }
  }
  const moments = await db.all('moments');
  for (const record of moments.filter((item) => ['journal', 'history', 'drawing'].includes(item.type))) {
    if (record?.id && !state.workspaceLinks.some((link) => link.workspaceId === workspaceId && link.recordType === (record.type === 'drawing' ? 'annotation' : 'journal') && link.recordId === String(record.id))) {
      additions.push(normalizeWorkspaceLink({ workspaceId, recordType: record.type === 'drawing' ? 'annotation' : 'journal', recordId: record.id }));
    }
  }
  if (additions.length) {
    await db.putMany({ workspace_links: additions });
    state.workspaceLinks = [...new Map([...state.workspaceLinks, ...additions].map((link) => [link.id, link])).values()];
  }
}

export async function loadWorkspaceState() {
  state.workspaces = (await db.all('workspaces')).map((item) => normalizeWorkspace(item));
  state.workspaceLinks = (await db.all('workspace_links')).map((item) => normalizeWorkspaceLink(item));
  const workspace = await ensureWorkspace();
  state.activeWorkspaceId = workspace.id;
  await linkExistingRecords(workspace.id);
}

// Local visual fixture for checking the filled workspace at phone widths.
// It is deliberately query-gated and never runs on a deployed origin.
export async function seedWorkspaceDemo() {
  const hostname = globalThis.location?.hostname || '';
  const params = new URLSearchParams(globalThis.location?.search || '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname) || params.get('workspace-demo') !== '1') return false;
  const now = Date.now();
  const stamp = (offset) => new Date(now - offset * 60_000).toISOString();
  const records = [
    ['saved_routes', { id: 'demo-route', title: 'Riverside loop', routeMode: 'round-trip', coordinates: [[38.901, -77.041], [38.906, -77.034], [38.909, -77.042], [38.901, -77.041]], sections: [{ title: 'Waterfront loop' }], durationSeconds: 1680, updatedAt: stamp(5) }, 'route'],
    ['walks', { id: 'demo-walk', title: 'Morning field walk', coordinates: [[38.901, -77.041], [38.904, -77.038], [38.907, -77.036]], note: 'Recorded beside the creek.', updatedAt: stamp(12) }, 'walk'],
    ['observations', { id: 'demo-observation', species: 'Red-tailed hawk', location: { lat: 38.906, lng: -77.034 }, note: 'Circling above the tree line.', updatedAt: stamp(19) }, 'observation'],
    ['geo_cypher_manifests', { id: 'demo-audio', title: 'Creek under the bridge', note: 'A short listening stop.', updatedAt: stamp(26) }, 'audio'],
    ['personal_places', { id: 'demo-place', name: 'Pocket overlook', location: { lat: 38.909, lng: -77.042 }, note: 'Good shade and a clear view downstream.', updatedAt: stamp(33) }, 'place'],
    ['moments', { id: 'demo-journal', type: 'journal', title: 'What changed here', note: 'The water is higher than last season.', updatedAt: stamp(40) }, 'journal'],
    ['moments', { id: 'demo-annotation', type: 'drawing', title: 'Quiet edge', body: { shape: 'Line', measurement: '240 ft shoreline mark' }, updatedAt: stamp(47) }, 'annotation']
  ];
  const byStore = {};
  for (const [store, record] of records) (byStore[store] ||= []).push(record);
  await db.putMany(byStore);
  const workspace = await ensureWorkspace();
  for (const [, record, type] of records) await linkWorkspaceRecord(workspace.id, type, record.id);
  window.dispatchEvent(new CustomEvent('workspace-changed'));
  return true;
}

export async function createWorkspace(name) {
  const workspace = normalizeWorkspace({ name });
  await db.put('workspaces', workspace);
  state.workspaces = [...state.workspaces, workspace];
  state.activeWorkspaceId = workspace.id;
  await linkExistingRecords(workspace.id);
  window.dispatchEvent(new CustomEvent('workspace-changed'));
  return workspace;
}

export async function ensureWorkspaceLinksForStore(store, recordType) {
  const workspace = state.workspaces.find((item) => item.id === DEFAULT_WORKSPACE_ID) || await ensureWorkspace();
  for (const record of await db.all(store)) if (record?.id && (store !== 'moments' || record.type === 'drawing')) await linkWorkspaceRecord(workspace.id, recordType, record.id);
  window.dispatchEvent(new CustomEvent('workspace-changed'));
}

function recordTitle(recordType, record) {
  return recordType === 'observation' ? (record.species || record.title || 'Observation')
    : recordType === 'audio' ? (record.title || 'Audio note')
      : recordType === 'route' ? (record.title || 'Saved walk')
        : recordType === 'plan' ? (record.request?.recipeLabel || 'Composed walk')
        : recordType === 'walk' ? (record.title || 'Recorded walk')
          : recordType === 'place' ? (record.name || 'Saved place')
            : recordType === 'annotation' ? (record.title || 'Map annotation')
              : recordType === 'journal' ? (record.title || 'Journal reflection') : 'Saved record';
}

function recordDetail(recordType, record) {
  if (recordType === 'route' || recordType === 'plan') return `${record.revision ? `revision ${record.revision} · ` : ''}${record.route?.durationSeconds ? `${Math.round(record.route.durationSeconds / 60)} min` : record.durationSeconds ? `${Math.round(record.durationSeconds / 60)} min` : 'route workspace'}`;
  if (recordType === 'annotation') return record.body?.measurement || record.body?.shape || 'Map drawing';
  if (recordType === 'audio') return record.note || record.notes || '';
  return record.note || record.notes || record.description || '';
}

function recordCoordinates(recordType, record) {
  const points = recordType === 'plan' ? (record.route?.geometry || []) : recordType === 'route' || recordType === 'walk' ? (record.coordinates || record.points || []) : [];
  if (Array.isArray(points)) {
    const normalized = points.map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.lat), Number(point?.lng)]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (normalized.length) return normalized;
  }
  const location = record.location || record.coordinates;
  const lat = Number(record.lat ?? location?.lat);
  const lng = Number(record.lng ?? location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng]] : [];
}

function focusWorkspaceRecord(recordType, record) {
  const map = state.map;
  const coordinates = recordCoordinates(recordType, record);
  if (!map || !coordinates.length) return;
  clearWorkspaceRoutePreview();
  if ((recordType === 'route' || recordType === 'plan') && coordinates.length > 1 && globalThis.L) {
    state.workspaceRoutePreviewId = String(record.id);
    state.workspaceRoutePreviewLines = [globalThis.L.polyline(coordinates, {
      color: /^#[0-9a-f]{6}$/i.test(record.color || '') ? record.color : '#173c35',
      weight: 7, opacity: .95, lineCap: 'round', lineJoin: 'round', interactive: false
    }).addTo(map)];
    state.workspaceRoutePreviewLines[0].bringToFront();
  }
  if (coordinates.length === 1) map.flyTo(coordinates[0], Math.max(map.getZoom?.() || 14, 16));
  else map.fitBounds(coordinates, { padding: [40, 40], maxZoom: 16 });
  window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: '' } }));
}

function clearWorkspaceRoutePreview() {
  state.workspaceRoutePreviewLines?.forEach((line) => line.remove());
  state.workspaceRoutePreviewLines = [];
  state.workspaceRoutePreviewId = null;
}

async function renderJournalRoomWorkspaceSummary() {
  const room = await db.get('rooms', 'room:journal');
  const items = Array.isArray(room?.data?.items) ? room.data.items : [];
  const poiCount = items.filter((item) => item.kind !== 'journal').length;
  const noteCount = items.filter((item) => item.kind === 'journal').length;
  const preview = items.slice(-4).reverse();
  return `<section class="workspace-journal-room" aria-label="Journal Room summary"><div class="workspace-journal-room-heading"><div><span class="sheet-kicker">PLACE COMPOSITION</span><h3>Journal Room</h3><p>${poiCount} POI${poiCount === 1 ? '' : 's'} · ${noteCount} journal note${noteCount === 1 ? '' : 's'}</p></div><button type="button" class="secondary-button" data-open-journal-room>Open room</button></div>${preview.length ? `<div class="workspace-journal-room-preview">${preview.map((item) => `<span class="workspace-journal-room-chip"><b>${item.kind === 'journal' ? '✎' : '⌖'}</b>${escapeHtml(item.name || 'Untitled')}</span>`).join('')}</div>` : '<p class="workspace-journal-room-empty">Your saved places and page notes will gather here.</p>'}</section>`;
}

const WORKSPACE_TOOLS = [['options', 'Walk options'], ['radio', 'Radio'], ['annotate', 'Draw / annotate'], ['journal', 'Journal'], ['learn', 'Learn'], ['places', 'Places']];
let activeWorkspaceTool = 'options';
const currentWalk = { title: 'Anacostia sampler', stops: ['Anacostia Riverwalk', 'Kingman Island'], evidence: ['Water edge · source-mapped', 'Habitat edge · modeled'], revision: 'Revision 3', duration: '35 min', mode: 'Loop' };
function workspaceToolNav() { return `<nav class="workspace-tool-nav" aria-label="Workspace tools">${WORKSPACE_TOOLS.filter(([id]) => id !== activeWorkspaceTool).map(([id, label]) => `<button type="button" data-workspace-tool="${id}">${label}</button>`).join('')}</nav>`; }
function workspacePlaceSuggestions() { const pois = (state.cityPois[state.activeCity] || []).filter((poi) => poi?.name && !currentWalk.stops.includes(poi.name)).slice(0, 3); const personal = (state.personalPlaces || []).slice(0, 3); return { pois, personal }; }
function workspacePage() {
  const tool = activeWorkspaceTool;
  if (tool === 'options') return `<div class="workspace-route-summary"><p class="workspace-kicker">CURRENT WALK</p><h2>${currentWalk.title}</h2><div class="workspace-route-meta"><span>${currentWalk.duration}</span><span>${currentWalk.mode}</span><span>${currentWalk.revision}</span></div><p>Two connected stops, with route evidence kept separate from modeled habitat context.</p><div class="workspace-stop-list">${currentWalk.stops.map((stop, i) => `<div><strong>${i + 1}</strong><span>${stop}<small>${currentWalk.evidence[i]}</small></span></div>`).join('')}</div><button type="button" class="primary-button workspace-start-walk">Start this walk</button><details class="workspace-walk-selector" open><summary>Today’s walk</summary><div class="workspace-choice-list"><button type="button" data-workspace-choice="today">Today’s walk</button><button type="button" data-workspace-choice="new">New walk</button></div></details><details class="workspace-records"><summary>Saved Workspace records & Journal Room</summary><div id="workspaceRecordsMount"><p>Saved records stay in the existing Workspace data model.</p></div></details></div>`;
  if (tool === 'builder') return `<div class="workspace-tool-page"><p class="workspace-kicker">WALK BUILDER</p><h2>Compose a new walk</h2><div class="workspace-segmented"><button type="button" class="active">Round trip</button><button type="button">Point to point</button></div><div class="workspace-time-grid">${['20 min', '35 min', '60 min'].map((v) => `<button type="button" class="${v === '35 min' ? 'active' : ''}">${v}</button>`).join('')}</div><p>The current walk stays unchanged until you explicitly compose a revision.</p><button type="button" class="primary-button" data-workspace-compose>Compose walk</button><button type="button" class="secondary-button" data-workspace-tool="options">Back to current walk</button></div>`;
  if (tool === 'radio') return `<div class="workspace-tool-page"><p class="workspace-kicker">ROUTE RADIO</p><h2>Radio for ${currentWalk.title}</h2><p>Audio is connected to this walk and follows its current route context.</p><div class="workspace-audio-placeholder"><button type="button" class="primary-button">Play route radio</button><span>Placeholder control · audio stays attached to the current walk</span></div><p class="workspace-context">Current route: ${currentWalk.stops.join(' · ')}</p><button type="button" class="secondary-button" data-workspace-tool="options">Back to walk</button></div>`;
  if (tool === 'annotate') return `<div class="workspace-tool-page"><p class="workspace-kicker">PERSONAL LAYER</p><h2>Draw / annotate</h2><p>Personal annotations are separate from route geometry and never change this walk automatically.</p><div class="workspace-action-grid"><button type="button" data-draw-shape="Marker">Add a pin</button><button type="button" data-draw-shape="Line">Draw a line</button><button type="button">Add a note</button></div><button type="button" class="secondary-button" data-workspace-tool="options">Back to walk</button></div>`;
  if (tool === 'journal') return `<div class="workspace-tool-page"><p class="workspace-kicker">JOURNAL</p><h2>Field notes for ${currentWalk.title}</h2><p>Route context: ${currentWalk.stops.join(' and ')}. Evidence: ${currentWalk.evidence.join('; ')}. Route reference: ${currentWalk.revision}.</p><div class="workspace-fact-card"><strong>Generated facts</strong><span>Two route stops are attached to the current walk; habitat edge is modeled.</span></div><textarea rows="5" data-workspace-reflection placeholder="Add your reflection"></textarea><button type="button" class="secondary-button">Add voice note (coming soon)</button><button type="button" class="secondary-button" data-workspace-tool="options">Back to walk</button></div>`;
  if (tool === 'learn') return `<div class="workspace-tool-page"><p class="workspace-kicker">LEARN</p><h2>Learn along this walk</h2><div data-workspace-learn-list><p>Loading linked learning content…</p></div><p class="workspace-legend"><b>verified</b> · <b>source-mapped</b> · <b>modeled</b> · <b>unverified</b></p><button type="button" class="secondary-button" data-workspace-tool="options">Back to walk</button></div>`;
  const suggestions = workspacePlaceSuggestions(); return `<div class="workspace-tool-page"><p class="workspace-kicker">PLACES</p><h2>Places near this walk</h2><section><p class="workspace-section-label">Current route stops</p>${currentWalk.stops.map((stop) => `<div class="workspace-place-row"><strong>${stop}</strong><span>Current route stop</span></div>`).join('')}</section><section><p class="workspace-section-label">Nearby suggestions</p>${suggestions.pois.length ? suggestions.pois.map((poi) => `<div class="workspace-place-row"><strong>${escapeHtml(poi.name)}</strong><span>${escapeHtml(poi.category || 'Place')} · source-mapped <button type="button" data-future-place="${escapeHtml(poi.id || poi.name)}">Add to future revision</button></span></div>`).join('') : '<p>No nearby suggestions are available in this region.</p>'}</section><section><p class="workspace-section-label">Personal saved places</p>${suggestions.personal.length ? suggestions.personal.map((place) => `<div class="workspace-place-row"><strong>${escapeHtml(place.name)}</strong><span>Personal saved place</span></div>`).join('') : '<p>No personal places saved yet.</p>'}</section><button type="button" class="secondary-button" data-workspace-tool="options">Back to walk</button></div>`;
}
async function hydrateWorkspaceLearn(target) { const list = target.querySelector('[data-workspace-learn-list]'); const source = document.getElementById('fieldGuideList'); if (!list || !source) return; await renderFieldGuide('learn'); list.innerHTML = source.innerHTML || '<p class="empty-state">No linked learning content is available for this route yet.</p>'; }
function renderWorkspaceExperience(target) { target.innerHTML = `<section class="workspace-experience" aria-label="Workspace"><header class="workspace-experience-header"><div><p class="workspace-kicker">WORKSPACE</p><h1>${currentWalk.title}</h1></div><button type="button" class="workspace-close-inline" data-workspace-close aria-label="Close Workspace">×</button></header><div class="workspace-tool-pills">${WORKSPACE_TOOLS.map(([id, label]) => `<button type="button" class="${activeWorkspaceTool === id ? 'active' : ''}" data-workspace-tool="${id}">${label}</button>`).join('')}</div>${workspacePage()}${activeWorkspaceTool !== 'options' ? workspaceToolNav() : ''}</section>`; target.querySelectorAll('[data-workspace-tool]').forEach((button) => button.addEventListener('click', () => { activeWorkspaceTool = button.dataset.workspaceTool; renderWorkspaceExperience(target); })); target.querySelector('[data-workspace-choice="new"]')?.addEventListener('click', () => { activeWorkspaceTool = 'builder'; renderWorkspaceExperience(target); }); target.querySelector('[data-workspace-choice="today"]')?.addEventListener('click', () => { activeWorkspaceTool = 'options'; renderWorkspaceExperience(target); }); target.querySelector('[data-workspace-compose]')?.addEventListener('click', async () => { await generateTimeBasedPlan({ title: 'Anacostia sampler · new revision', reason: 'Composed from Workspace' }); }); target.querySelector('.workspace-audio-placeholder button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('radio-open-requested', { detail: { context: { routeTitle: currentWalk.title, stops: currentWalk.stops } } }))); target.querySelectorAll('[data-draw-shape]').forEach((button) => button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: 'draw', forceOpen: true } })))); target.querySelector('[data-workspace-reflection]')?.addEventListener('change', async (event) => { const note = String(event.target.value || '').trim(); if (!note) return; const now = new Date().toISOString(); await db.put('moments', { id: 'workspace-reflection-current', type: 'journal', title: `Reflection · ${currentWalk.title}`, note, walkId: 'workspace-current-walk', createdAt: now, updatedAt: now }); window.dispatchEvent(new CustomEvent('journal-data-changed')); }); if (activeWorkspaceTool === 'learn') void hydrateWorkspaceLearn(target); }

async function renderWorkspaceRecordSummary(target) {
  const mount = target.querySelector('#workspaceRecordsMount');
  if (!mount) return;
  const rows = [];
  for (const [store, type] of LINKABLE_STORES) for (const record of await db.all(store)) rows.push({ type, record });
  const moments = await db.all('moments');
  for (const record of moments.filter((item) => ['journal', 'history', 'drawing'].includes(item.type))) rows.push({ type: record.type === 'drawing' ? 'annotation' : 'journal', record });
  rows.sort((a, b) => Date.parse(b.record.updatedAt || b.record.createdAt || 0) - Date.parse(a.record.updatedAt || a.record.createdAt || 0));
  mount.innerHTML = rows.length ? `<div class="workspace-record-summary-list">${rows.slice(0, 8).map(({ type, record }) => `<div class="workspace-record-summary-row"><strong>${escapeHtml(recordTitle(type, record))}</strong><span>${escapeHtml(recordDetail(type, record) || 'Saved locally')}</span></div>`).join('')}</div><button type="button" class="secondary-button" data-open-journal-room>Open Journal Room</button>` : '<p class="empty-state">No saved Workspace records yet.</p>';
}

export async function renderWorkspacePanel(target, { filter = 'all' } = {}) {
  if (!target) return;
  target.classList.add('workspace-home');
  renderWorkspaceExperience(target);
  await renderWorkspaceRecordSummary(target);
  return;
  let workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) || state.workspaces.find((item) => item.id === DEFAULT_WORKSPACE_ID) || state.workspaces[0];
  if (!workspace) {
    workspace = normalizeWorkspace({ id: DEFAULT_WORKSPACE_ID, name: 'My Workspace' });
    state.workspaces = [workspace];
    state.activeWorkspaceId = workspace.id;
    await db.put('workspaces', workspace);
  }
  // Reconcile on open too: older capture flows do not all emit change events.
  await linkExistingRecords(workspace.id);
  const records = new Map();
  for (const [store, type] of LINKABLE_STORES) for (const record of await db.all(store)) records.set(`${type}:${record.id}`, { record, type, store });
  for (const record of await db.all('moments')) if (['journal', 'history', 'drawing'].includes(record.type)) records.set(`${record.type === 'drawing' ? 'annotation' : 'journal'}:${record.id}`, { record, type: record.type === 'drawing' ? 'annotation' : 'journal', store: 'moments' });
  const links = state.workspaceLinks.filter((link) => link.workspaceId === workspace.id && (filter === 'all' || link.recordType === filter || (filter === 'route' && ['walk', 'plan'].includes(link.recordType))));
  const timeline = links.map((link) => ({ link, ...records.get(`${link.recordType}:${link.recordId}`) })).filter((item) => item.record).sort((a, b) => Date.parse(b.record.updatedAt || b.record.createdAt || 0) - Date.parse(a.record.updatedAt || a.record.createdAt || 0));
  const filterButtons = [['all', 'All'], ['route', 'Routes'], ['observation', 'Seen'], ['audio', 'Sound'], ['journal', 'Notes'], ['place', 'Places'], ['annotation', 'Marks']].map(([id, label]) => `<button type="button" class="workspace-filter ${filter === id ? 'active' : ''}" data-workspace-filter="${id}">${label}</button>`).join('');
  const journalRoomSummary = await renderJournalRoomWorkspaceSummary();
  target.innerHTML = `<section class="workspace-home" aria-label="${escapeHtml(workspace.name)}">${journalRoomSummary}<div class="workspace-toolbar"><span class="workspace-count" aria-live="polite">${timeline.length} items</span><button type="button" class="icon-button workspace-new-button" id="addPersonalPlaceButton" aria-label="Add location" title="Add location">＋</button></div><div class="workspace-filter-row" role="tablist" aria-label="Workspace filters">${filterButtons}</div><div class="workspace-timeline">${timeline.length ? timeline.map(({ link, record, type, store }) => { const detail = recordDetail(type, record); return `<article class="workspace-record workspace-record-${type}" data-workspace-focus="${escapeHtml(record.id)}" data-record-type="${escapeHtml(type)}" data-record-store="${escapeHtml(store)}" title="Open on map"><div class="workspace-record-icon" aria-hidden="true">${type === 'route' ? '↝' : type === 'audio' ? '◉' : type === 'observation' ? '◌' : type === 'annotation' ? '⌁' : type === 'place' ? '⌖' : '✎'}</div><div class="workspace-record-body"><h3>${escapeHtml(recordTitle(type, record))}</h3>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</div><div class="workspace-record-actions"><button type="button" class="icon-button workspace-map-action" data-workspace-map="${escapeHtml(record.id)}" aria-label="Open ${escapeHtml(recordTitle(type, record))} on map" title="Open on map">⌖</button>${type === 'route' ? `<button type="button" class="icon-button" data-edit-saved-route="${escapeHtml(record.id)}" aria-label="Configure ${escapeHtml(recordTitle(type, record))}" title="Configure">⚙</button>` : ''}${type === 'place' ? `<button type="button" class="icon-button" data-edit-personal-place="${escapeHtml(record.id)}" aria-label="Edit ${escapeHtml(recordTitle(type, record))}" title="Edit">✎</button>` : ''}<button type="button" class="icon-button danger-button" data-workspace-delete="${escapeHtml(record.id)}" data-record-type="${escapeHtml(type)}" data-record-store="${escapeHtml(store)}" aria-label="Delete ${escapeHtml(recordTitle(type, record))}" title="Delete">×</button></div></article>`; }).join('') : '<p class="empty-state">No records yet.</p>'}</div></section>`;
}

export function initWorkspaceRuntime() {
  if (initWorkspaceRuntime.bound) return;
  initWorkspaceRuntime.bound = true;
  document.addEventListener('click', async (event) => {
    const tool = event.target.closest('[data-workspace-tool]')?.dataset.workspaceTool;
    if (tool) { activeWorkspaceTool = tool; const target = document.querySelector('#personalPlacesPanel .workspace-home'); if (target) renderWorkspaceExperience(target); return; }
    if (event.target.closest('[data-workspace-choice="new"]')) { activeWorkspaceTool = 'builder'; const target = document.querySelector('#personalPlacesPanel .workspace-home'); if (target) renderWorkspaceExperience(target); return; }
    if (event.target.closest('[data-workspace-choice="today"]')) { activeWorkspaceTool = 'options'; const target = document.querySelector('#personalPlacesPanel .workspace-home'); if (target) renderWorkspaceExperience(target); return; }
    if (event.target.closest('[data-workspace-close]')) { window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: '' } })); return; }
    const futurePlace = event.target.closest('[data-future-place]');
    if (futurePlace) { state.workspaceFuturePlaces ||= []; if (!state.workspaceFuturePlaces.includes(futurePlace.dataset.futurePlace)) state.workspaceFuturePlaces.push(futurePlace.dataset.futurePlace); futurePlace.textContent = 'Saved for future revision'; futurePlace.disabled = true; return; }
    if (event.target.closest('[data-open-journal-room]')) { window.dispatchEvent(new CustomEvent('journal-room-open-requested')); return; }
    const mapButton = event.target.closest('[data-workspace-map]');
    const mapRecord = mapButton?.closest('[data-workspace-focus]');
    if (mapRecord) {
      const store = mapRecord.dataset.recordStore;
      const record = (await db.all(store)).find((item) => String(item.id) === mapRecord.dataset.workspaceFocus);
      if (record) focusWorkspaceRecord(mapRecord.dataset.recordType, record);
      return;
    }
    const button = event.target.closest('[data-workspace-delete]');
    if (!button) return;
    if (!window.confirm('Delete this local record permanently? It will be removed from all workspaces on this device. This cannot be undone.')) return;
    button.disabled = true;
    try { await deleteWorkspaceRecord(button.dataset.recordType, button.dataset.workspaceDelete, button.dataset.recordStore); }
    catch { button.disabled = false; window.alert('Could not delete this record. Please try again.'); }
  });
  const stores = [['saved-routes-changed', 'saved_routes', 'route'], ['observations-changed', 'observations', 'observation'], ['geo-cyphers-changed', 'geo_cypher_manifests', 'audio'], ['local-drawings-changed', 'moments', 'annotation'], ['personal-places-changed', 'personal_places', 'place'], ['walks-changed', 'walks', 'walk']];
  stores.forEach(([event, store, type]) => window.addEventListener(event, () => void ensureWorkspaceLinksForStore(store, type)));
  window.addEventListener('saved-routes-changed', () => {
    if (!state.workspaceRoutePreviewId) return;
    const route = state.savedRoutes.find((item) => String(item.id) === state.workspaceRoutePreviewId);
    if (route) focusWorkspaceRecord('route', route); else clearWorkspaceRoutePreview();
  });
  window.addEventListener('workspace-changed', () => window.dispatchEvent(new CustomEvent('journal-data-changed')));
}
