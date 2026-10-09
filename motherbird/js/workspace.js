import db from './storage.js';
import { state } from './state.js';
import { escapeHtml, uid } from './utils.js';

const DEFAULT_WORKSPACE_ID = 'workspace:my-workspace';
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
  state.workspaceLinks = [...state.workspaceLinks, link];
  return link;
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
    state.workspaceLinks = [...state.workspaceLinks, ...additions];
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
  for (const record of await db.all(store)) if (record?.id) await linkWorkspaceRecord(workspace.id, recordType, record.id);
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
  const records = new Map();
  for (const [store, type] of LINKABLE_STORES) for (const record of await db.all(store)) records.set(`${type}:${record.id}`, { record, type });
  for (const record of state.savedRoutes || []) records.set(`route:${record.id}`, { record, type: 'route' });
  for (const record of await db.all('moments')) if (['journal', 'history', 'drawing'].includes(record.type)) records.set(`${record.type === 'drawing' ? 'annotation' : 'journal'}:${record.id}`, { record, type: record.type === 'drawing' ? 'annotation' : 'journal' });
  const links = state.workspaceLinks.filter((link) => link.workspaceId === workspace.id && (filter === 'all' || link.recordType === filter));
  const timeline = links.map((link) => ({ link, ...records.get(`${link.recordType}:${link.recordId}`) })).filter((item) => item.record).sort((a, b) => Date.parse(b.record.updatedAt || b.record.createdAt || 0) - Date.parse(a.record.updatedAt || a.record.createdAt || 0));
  const filterButtons = [['all', 'Everything'], ['route', 'Routes'], ['observation', 'Observations'], ['audio', 'Audio'], ['journal', 'Notes'], ['place', 'Places'], ['annotation', 'Annotations']].map(([id, label]) => `<button type="button" class="workspace-filter ${filter === id ? 'active' : ''}" data-workspace-filter="${id}">${label}</button>`).join('');
  target.innerHTML = `<section class="workspace-home" aria-labelledby="workspaceTitle"><div class="workspace-heading"><div><p class="eyebrow">LIBRARY · FIELD NOTEBOOK</p><h2 id="workspaceTitle">${escapeHtml(workspace.name)}</h2><p>${escapeHtml(workspace.description)}</p></div><button type="button" class="secondary-button" data-create-workspace>New workspace</button></div><div class="workspace-filter-row" role="tablist" aria-label="Workspace filters">${filterButtons}</div><div class="workspace-progress"><strong>${timeline.length} linked record${timeline.length === 1 ? '' : 's'}</strong><span>Routes, places, observations, audio, notes, and annotations stay in their original local stores.</span></div><div class="workspace-timeline">${timeline.length ? timeline.map(({ link, record, type }) => `<article class="workspace-record workspace-record-${type}"><div class="workspace-record-icon" aria-hidden="true">${type === 'route' ? '↝' : type === 'audio' ? '◉' : type === 'observation' ? '◌' : type === 'annotation' ? '⌁' : type === 'place' ? '⌖' : '✎'}</div><div><small>${escapeHtml(type)}</small><h3>${escapeHtml(recordTitle(type, record))}</h3><p>${escapeHtml(recordDetail(type, record))}</p></div>${type === 'route' ? `<button type="button" class="text-button" data-edit-saved-route="${escapeHtml(record.id)}">Configure</button>` : ''}</article>`).join('') : '<p class="empty-state">Nothing is linked here yet. Save a route, place, observation, audio note, or annotation to grow this workspace.</p>'}</div></section>`;
}

export function initWorkspaceRuntime() {
  if (initWorkspaceRuntime.bound) return;
  initWorkspaceRuntime.bound = true;
  const stores = [['saved-routes-changed', 'saved_routes', 'route'], ['observations-changed', 'observations', 'observation'], ['geo-cyphers-changed', 'geo_cypher_manifests', 'audio'], ['local-drawings-changed', 'moments', 'annotation'], ['personal-places-changed', 'personal_places', 'place'], ['walks-changed', 'walks', 'walk']];
  stores.forEach(([event, store, type]) => window.addEventListener(event, () => void ensureWorkspaceLinksForStore(store, type)));
  window.addEventListener('workspace-changed', () => window.dispatchEvent(new CustomEvent('journal-data-changed')));
}
