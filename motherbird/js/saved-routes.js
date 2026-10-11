import { state } from './state.js';
import db from './storage.js';
import { uid, escapeHtml } from './utils.js';
import { linkSavedRecord, deleteWorkspaceRecord } from './workspace.js';

export function normalizeSavedRoute(route = {}, now = new Date().toISOString()) {
  const coordinates = Array.isArray(route.coordinates) ? route.coordinates.filter((point) => Array.isArray(point) && point.length >= 2).map(([lat, lng]) => [Number(lat), Number(lng)]) : [];
  const stops = Array.isArray(route.stops) ? route.stops.map((stop, index) => ({
    id: String(stop.id || `stop-${index + 1}`), name: String(stop.name || `Stop ${index + 1}`).trim().slice(0, 100),
    lat: Number(stop.lat), lng: Number(stop.lng)
  })).filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) : [];
  const rawSections = Array.isArray(route.sections) ? route.sections : [];
  const sections = rawSections.map((section, index) => ({
    id: String(section.id || `section-${index + 1}`), title: String(section.title || `Section ${index + 1}`).trim().slice(0, 100),
    notes: String(section.notes || '').trim().slice(0, 500),
    stops: Array.isArray(section.stops) ? section.stops : [],
    coordinates: Array.isArray(section.coordinates) ? section.coordinates : [],
    geometry: section.geometry || null,
    distanceMeters: Number.isFinite(Number(section.distanceMeters)) ? Number(section.distanceMeters) : null,
    durationSeconds: Number.isFinite(Number(section.durationSeconds)) ? Number(section.durationSeconds) : null,
    status: ['upcoming', 'active', 'completed'].includes(section.status) ? section.status : 'upcoming',
    completedAt: section.completedAt || null,
    alternatives: Array.isArray(section.alternatives) ? section.alternatives : [],
    mip: section.mip || null
  })).filter((section) => section.title);
  if (coordinates.length < 2) throw new Error('A saved route needs at least two points.');
  if (!sections.length) sections.push({ id: `section-${uid('legacy')}`, title: 'Main route', notes: '', stops, coordinates, geometry: null, distanceMeters: route.distanceMeters ?? null, durationSeconds: route.durationSeconds ?? null, status: 'upcoming', completedAt: null, alternatives: [], mip: null });
  return {
    id: String(route.id || uid('saved-route')), city: String(route.city || state.activeCity || ''),
    title: String(route.title || 'Saved route').trim().slice(0, 100),
    notes: String(route.notes || '').trim().slice(0, 2000),
    icon: String(route.icon || 'route').trim().slice(0, 30),
    color: /^#[0-9a-f]{6}$/i.test(route.color || '') ? route.color : '#173c35',
    routeMode: String(route.routeMode || 'round-trip'),
    discoverCategoryId: route.discoverCategoryId ? String(route.discoverCategoryId) : null,
    draft: route.draft === true,
    routeOptions: Array.isArray(route.routeOptions || route.alternatives) ? (route.routeOptions || route.alternatives).map((option) => ({
      id: String(option.id || ''), title: String(option.title || ''), subtitle: String(option.subtitle || ''),
      archetype: String(option.archetype || ''), coordinates: Array.isArray(option.coordinates) ? option.coordinates : [],
      distanceMeters: Number(option.distanceMeters || 0), durationSeconds: Number(option.durationSeconds || 0)
    })).filter((option) => option.id && option.coordinates.length >= 2) : [],
    stops, sections,
    routeIntent: route.routeIntent || route.intent || null,
    discoveryStyle: route.discoveryStyle || null,
    quietProfile: route.quietProfile || route.quietDiscoveryProfile || null,
    reasoning: route.reasoning || route.reason || null,
    timing: route.timing || null,
    provenance: route.provenance || null,
    mip: route.mip || route.mipMetadata || null,
    metadata: route.metadata || null,
    distanceMeters: Number.isFinite(Number(route.distanceMeters)) ? Number(route.distanceMeters) : null,
    durationSeconds: Number.isFinite(Number(route.durationSeconds)) ? Number(route.durationSeconds) : null,
    coordinates,
    destination: route.destination && Number.isFinite(Number(route.destination.lat)) && Number.isFinite(Number(route.destination.lng)) ? { lat: Number(route.destination.lat), lng: Number(route.destination.lng) } : null,
    createdAt: route.createdAt || now, updatedAt: now, saved: true
  };
}

export function savedRouteEditorHtml(route) {
  const sections = route.sections?.length ? route.sections : [{ id: 'section-new', title: 'Main route', notes: '', stops: [] }];
  return `<details class="saved-route-editor"><summary>Configure route workspace</summary><form data-saved-route-editor="${escapeHtml(route.id)}"><label>Route name<input name="title" maxlength="100" value="${escapeHtml(route.title || '')}" /></label><label>Notes<textarea name="notes" rows="2" maxlength="2000">${escapeHtml(route.notes || '')}</textarea></label><div class="route-section-editor" data-route-sections>${sections.map((section, index) => `<div class="route-section-row" draggable="true" data-route-section-row><div class="route-section-grip" aria-hidden="true">⋮⋮</div><div class="route-section-fields"><label>Section ${index + 1}<input name="sectionTitle" maxlength="100" value="${escapeHtml(section.title || '')}" /></label><label>Stops <input name="sectionStops" placeholder="Place names, comma separated" value="${escapeHtml((section.stops || []).map((stop) => typeof stop === 'string' ? stop : stop.name || stop.id || '').join(', '))}" /></label><label>Section notes<textarea name="sectionNotes" rows="2" maxlength="500">${escapeHtml(section.notes || '')}</textarea></label></div><div class="route-section-actions"><button type="button" class="text-button" data-section-up>↑</button><button type="button" class="text-button" data-section-down>↓</button><button type="button" class="text-button danger-button" data-section-remove>Remove</button></div></div>`).join('')}</div><button type="button" class="secondary-button" data-section-add>Add section</button><div class="route-config-actions"><button type="submit" class="primary-button">Save workspace changes</button><button type="button" class="secondary-button" data-section-suggest>Suggest optional refinements</button></div><p class="route-section-suggestions" data-section-suggestions aria-live="polite"></p></form></details>`;
}

export function normalizeRouteSections(value = []) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return entries.map((section, index) => typeof section === 'string'
    ? { id: `section-${Date.now()}-${index + 1}`, title: section.trim(), notes: '' }
    : { id: String(section.id || `section-${Date.now()}-${index + 1}`), title: String(section.title || '').trim(), notes: String(section.notes || '').trim() })
    .filter((section) => section.title).slice(0, 30);
}

export async function savePlannedRoute(plan, fields = {}) {
  const route = normalizeSavedRoute({ ...plan, ...fields, id: fields.id || null, coordinates: plan.coordinates });
  await db.put('saved_routes', route);
  state.savedRoutes = [...state.savedRoutes.filter((item) => item.id !== route.id), route];
  await linkSavedRecord('route', route.id);
  window.dispatchEvent(new CustomEvent('saved-routes-changed'));
  return route;
}

export async function updateSavedRoute(id, fields = {}) {
  const existing = state.savedRoutes.find((route) => route.id === id);
  if (!existing) return null;
  return savePlannedRoute(existing, { ...fields, id });
}

const pendingAutoSaves = new Map();
export async function ensurePlannedRouteSaved(plan, options = []) {
  if (!plan?.coordinates || plan.coordinates.length < 2) throw new Error('Generate a walkable route first.');
  // Planner option IDs (e.g. ambient-direct) are reused on every generation.
  // Identity belongs to this plan instance, not the option's display ID.
  const id = plan.workspaceRouteId || (plan.workspaceRouteId = plan.saved || plan.fromSavedRouteOption ? plan.id : uid('walk-draft'));
  if (pendingAutoSaves.has(id)) return pendingAutoSaves.get(id);
  const save = (async () => {
    const existing = state.savedRoutes.find((route) => route.id === id) || await db.get('saved_routes', id);
    if (existing) { await linkSavedRecord('route', id); return existing; }
    return savePlannedRoute(plan, { id, title: plan.title || 'Walk draft', notes: plan.reason || '', draft: true, routeOptions: options.length ? options : plan.routeOptions || [] });
  })();
  pendingAutoSaves.set(id, save);
  try { const route = await save; plan.workspaceSaved = true; return route; }
  finally { pendingAutoSaves.delete(id); }
}

export async function deleteSavedRoute(id) {
  await deleteWorkspaceRecord('route', id, 'saved_routes');
}
