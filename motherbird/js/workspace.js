import db from './storage.js';
import { state } from './state.js';
import { escapeHtml, uid } from './utils.js';

export const DEFAULT_WORKSPACE_ID = 'workspace:my-workspace';
const LINKABLE_STORES = [
  ['saved_routes', 'route'], ['walks', 'walk'], ['observations', 'observation'],
  ['geo_cypher_manifests', 'audio'], ['voice_notes', 'audio'], ['personal_places', 'place']
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
  state[key] = (state[key] || []).filter((record) => String(record.id) !== recordId);
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
        : recordType === 'walk' ? (record.title || 'Recorded walk')
          : recordType === 'place' ? (record.name || 'Saved place')
            : recordType === 'annotation' ? (record.title || 'Map annotation')
              : recordType === 'journal' ? (record.title || 'Journal reflection') : 'Saved record';
}

function recordDetail(recordType, record) {
  if (recordType === 'route') return `${(record.sections || []).length || 1} section${(record.sections || []).length === 1 ? '' : 's'} · ${record.durationSeconds ? `${Math.round(record.durationSeconds / 60)} min` : 'route workspace'}`;
  if (recordType === 'annotation') return record.body?.measurement || record.body?.shape || 'Map drawing';
  if (recordType === 'audio') return 'Private on this device';
  return record.note || record.notes || record.description || 'Saved in this workspace';
}

export async function renderWorkspacePanel(target, { filter = 'all' } = {}) {
  if (!target) return;
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
  const links = state.workspaceLinks.filter((link) => link.workspaceId === workspace.id && (filter === 'all' || link.recordType === filter || (filter === 'route' && link.recordType === 'walk')));
  const timeline = links.map((link) => ({ link, ...records.get(`${link.recordType}:${link.recordId}`) })).filter((item) => item.record).sort((a, b) => Date.parse(b.record.updatedAt || b.record.createdAt || 0) - Date.parse(a.record.updatedAt || a.record.createdAt || 0));
  const filterButtons = [['all', 'Everything'], ['route', 'Routes'], ['observation', 'Observations'], ['audio', 'Audio'], ['journal', 'Notes'], ['place', 'Places'], ['annotation', 'Annotations']].map(([id, label]) => `<button type="button" class="workspace-filter ${filter === id ? 'active' : ''}" data-workspace-filter="${id}">${label}</button>`).join('');
  target.innerHTML = `<section class="workspace-home" aria-labelledby="workspaceTitle"><div class="workspace-heading"><div><p class="eyebrow">LIBRARY · FIELD NOTEBOOK</p><h2 id="workspaceTitle">${escapeHtml(workspace.name)}</h2><p>${escapeHtml(workspace.description)}</p></div><button type="button" class="secondary-button" data-create-workspace>New workspace</button></div><div class="workspace-filter-row" role="tablist" aria-label="Workspace filters">${filterButtons}</div><div class="workspace-progress"><strong>${timeline.length} linked record${timeline.length === 1 ? '' : 's'}</strong><span>Routes, places, observations, audio, notes, and annotations stay in their original local stores.</span></div><div class="workspace-timeline">${timeline.length ? timeline.map(({ link, record, type, store }) => `<article class="workspace-record workspace-record-${type}"><div class="workspace-record-icon" aria-hidden="true">${type === 'route' ? '↝' : type === 'audio' ? '◉' : type === 'observation' ? '◌' : type === 'annotation' ? '⌁' : type === 'place' ? '⌖' : '✎'}</div><div><small>${escapeHtml(type)}</small><h3>${escapeHtml(recordTitle(type, record))}</h3><p>${escapeHtml(recordDetail(type, record))}</p></div>${type === 'route' ? `<button type="button" class="text-button" data-edit-saved-route="${escapeHtml(record.id)}">Configure</button>` : ''}<button type="button" class="text-button danger-button" data-workspace-delete="${escapeHtml(record.id)}" data-record-type="${escapeHtml(type)}" data-record-store="${escapeHtml(store)}" aria-label="Delete ${escapeHtml(recordTitle(type, record))}">Delete</button></article>`).join('') : '<p class="empty-state">Nothing is linked here yet. Save a route, place, observation, audio note, or annotation to grow this workspace.</p>'}</div></section>`;
}

export function initWorkspaceRuntime() {
  if (initWorkspaceRuntime.bound) return;
  initWorkspaceRuntime.bound = true;
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-workspace-delete]');
    if (!button) return;
    if (!window.confirm('Delete this local record permanently? It will be removed from all workspaces on this device. This cannot be undone.')) return;
    button.disabled = true;
    try { await deleteWorkspaceRecord(button.dataset.recordType, button.dataset.workspaceDelete, button.dataset.recordStore); }
    catch { button.disabled = false; window.alert('Could not delete this record. Please try again.'); }
  });
  const stores = [['saved-routes-changed', 'saved_routes', 'route'], ['observations-changed', 'observations', 'observation'], ['geo-cyphers-changed', 'geo_cypher_manifests', 'audio'], ['local-drawings-changed', 'moments', 'annotation'], ['personal-places-changed', 'personal_places', 'place'], ['walks-changed', 'walks', 'walk']];
  stores.forEach(([event, store, type]) => window.addEventListener(event, () => void ensureWorkspaceLinksForStore(store, type)));
  window.addEventListener('workspace-changed', () => window.dispatchEvent(new CustomEvent('journal-data-changed')));
}
