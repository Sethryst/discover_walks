import db from './storage.js';
import { state } from './state.js';

export const OUTING_DRAFT_SCHEMA = 'outing-draft/v1';
export const ACTIVE_OUTING_DRAFT_ID = 'outing-draft:active';
export const OUTING_PLACE_ROLES = Object.freeze(['possible-stop', 'destination', 'start', 'pass-through', 'avoid']);

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const clone = (value) => value == null ? value : structuredClone(value);

function coordinate(value, fallback = null) {
  const lat = Number(value?.lat ?? value?.location?.lat);
  const lng = Number(value?.lng ?? value?.location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : fallback;
}

function normalizeItem(item, index = 0) {
  const point = coordinate(item);
  if (!point) return null;
  const role = OUTING_PLACE_ROLES.includes(item?.role) ? item.role : 'possible-stop';
  return {
    id: String(item?.id || uid('outing-item')),
    placeId: item?.placeId == null ? null : String(item.placeId),
    name: String(item?.name || item?.label || `Place ${index + 1}`),
    ...point,
    role,
    source: item?.source || 'map',
    facts: Array.isArray(item?.facts) ? clone(item.facts) : [],
    addedAt: item?.addedAt || now()
  };
}

export function createOutingDraft({ id = ACTIVE_OUTING_DRAFT_ID, city = state.activeCity || null, branchOf = null, items = [], recipeId = null, timePreferenceMinutes = null, travelMode = 'walking' } = {}) {
  const createdAt = now();
  return normalizeOutingDraft({
    schema: OUTING_DRAFT_SCHEMA,
    id,
    draftId: uid('outing-draft'),
    city,
    branchOf,
    items,
    recipeId,
    travelMode,
    timePreferenceMinutes,
    routePreview: { status: 'idle', coordinates: [], distanceMeters: 0, durationSeconds: 0, message: 'Add places when you want the route to emerge.' },
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    activeWalkId: null,
    plannedRouteId: null
  });
}

export function normalizeOutingDraft(input = {}) {
  const items = (input.items || []).map(normalizeItem).filter(Boolean);
  return {
    schema: OUTING_DRAFT_SCHEMA,
    id: String(input.id || ACTIVE_OUTING_DRAFT_ID),
    draftId: String(input.draftId || (input.id && input.id !== ACTIVE_OUTING_DRAFT_ID ? input.id : uid('outing-draft'))),
    city: input.city || null,
    branchOf: input.branchOf || null,
    items,
    recipeId: input.recipeId || null,
    travelMode: ['walking', 'cycling', 'driving'].includes(input.travelMode) ? input.travelMode : 'walking',
    timePreferenceMinutes: Number.isFinite(Number(input.timePreferenceMinutes)) ? Number(input.timePreferenceMinutes) : null,
    routePreview: {
      status: input.routePreview?.status || 'idle',
      coordinates: clone(input.routePreview?.coordinates || []),
      distanceMeters: Number(input.routePreview?.distanceMeters || 0),
      durationSeconds: Number(input.routePreview?.durationSeconds || 0),
      message: input.routePreview?.message || '',
      graphVersion: input.routePreview?.graphVersion || null,
      cellId: input.routePreview?.cellId || null,
      cellRelease: input.routePreview?.cellRelease || null,
      edgeIds: [...(input.routePreview?.edgeIds || [])],
      instructions: clone(input.routePreview?.instructions || [])
    },
    status: input.status || 'draft',
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now(),
    activeWalkId: input.activeWalkId || null,
    plannedRouteId: input.plannedRouteId || null
  };
}

export async function saveOutingDraft(input) {
  const draft = normalizeOutingDraft({ ...input, updatedAt: now() });
  await db.put('walk_drafts', draft);
  state.outingDraft = draft;
  globalThis.window?.dispatchEvent(new CustomEvent('outing-draft-changed', { detail: clone(draft) }));
  return draft;
}

export async function loadOutingDraft(id = ACTIVE_OUTING_DRAFT_ID) {
  const stored = await db.get('walk_drafts', id);
  if (!stored || stored.schema !== OUTING_DRAFT_SCHEMA) return null;
  const draft = normalizeOutingDraft(stored);
  state.outingDraft = draft;
  return draft;
}

export async function ensureOutingDraft(options = {}) {
  return (await loadOutingDraft(options.id || ACTIVE_OUTING_DRAFT_ID)) || saveOutingDraft(createOutingDraft(options));
}

function staleRoute(routePreview = {}) {
  return {
    ...routePreview,
    status: routePreview.coordinates?.length ? 'stale' : 'idle',
    message: routePreview.coordinates?.length ? 'Places changed. Updating the route consequence…' : 'Add another place when you want a route preview.'
  };
}

export async function addOutingItem(input, role = 'possible-stop', draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  const item = normalizeItem({ ...input, role }, current.items.length);
  if (!item) throw new TypeError('An outing item requires map coordinates.');
  const duplicate = current.items.find((candidate) => candidate.placeId && item.placeId && candidate.placeId === item.placeId);
  const items = duplicate
    ? current.items.map((candidate) => candidate.id === duplicate.id ? { ...candidate, ...item, id: candidate.id, addedAt: candidate.addedAt } : candidate)
    : [...current.items, item];
  return saveOutingDraft({ ...current, items, routePreview: staleRoute(current.routePreview) });
}

export async function removeOutingItem(itemId, draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  return saveOutingDraft({ ...current, items: current.items.filter((item) => item.id !== itemId), routePreview: staleRoute(current.routePreview) });
}

export async function setOutingItemRole(itemId, role, draft = state.outingDraft) {
  if (!OUTING_PLACE_ROLES.includes(role)) throw new TypeError(`Unsupported outing role: ${role}`);
  const current = normalizeOutingDraft(draft || createOutingDraft());
  return saveOutingDraft({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, role } : item), routePreview: staleRoute(current.routePreview) });
}

export async function updateOutingRoutePreview(routePreview, draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  return saveOutingDraft({ ...current, routePreview: { ...current.routePreview, ...clone(routePreview) } });
}

export async function updateOutingPreferences(patch = {}, draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  return saveOutingDraft({
    ...current,
    recipeId: Object.hasOwn(patch, 'recipeId') ? patch.recipeId || null : current.recipeId,
    travelMode: Object.hasOwn(patch, 'travelMode') && ['walking', 'cycling', 'driving'].includes(patch.travelMode) ? patch.travelMode : current.travelMode,
    timePreferenceMinutes: Object.hasOwn(patch, 'timePreferenceMinutes') ? (Number(patch.timePreferenceMinutes) || null) : current.timePreferenceMinutes
  });
}

export async function branchOutingDraft(draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  const archived = normalizeOutingDraft({ ...clone(current), id: current.draftId, status: 'branched', updatedAt: now() });
  await db.put('walk_drafts', archived);
  const branch = normalizeOutingDraft({
    ...clone(current),
    id: ACTIVE_OUTING_DRAFT_ID,
    draftId: uid('outing-draft'),
    branchOf: current.draftId,
    status: 'draft',
    activeWalkId: null,
    plannedRouteId: null,
    createdAt: now(),
    updatedAt: now()
  });
  return saveOutingDraft(branch);
}

export async function linkOutingToWalk(walkId, draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  return saveOutingDraft({ ...current, activeWalkId: walkId || null, status: walkId ? 'active' : current.status });
}

export async function completeOutingForWalk(walkId, draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  if (walkId && current.activeWalkId && String(walkId) !== String(current.activeWalkId)) return current;
  return saveOutingDraft({ ...current, status: 'completed', activeWalkId: walkId || current.activeWalkId });
}

export function outingRouteItems(draft = state.outingDraft) {
  const current = normalizeOutingDraft(draft || createOutingDraft());
  const starts = current.items.filter((item) => item.role === 'start');
  const middle = current.items.filter((item) => ['possible-stop', 'pass-through'].includes(item.role));
  const destinations = current.items.filter((item) => item.role === 'destination');
  return [...starts.slice(-1), ...middle, ...destinations.slice(-1)];
}
