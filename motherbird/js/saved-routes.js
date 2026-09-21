import { state } from './state.js';
import db from './storage.js';
import { uid } from './utils.js';

export function normalizeSavedRoute(route = {}, now = new Date().toISOString()) {
  const coordinates = Array.isArray(route.coordinates) ? route.coordinates.filter((point) => Array.isArray(point) && point.length >= 2).map(([lat, lng]) => [Number(lat), Number(lng)]) : [];
  if (coordinates.length < 2) throw new Error('A saved route needs at least two points.');
  return {
    id: String(route.id || uid('saved-route')), city: String(route.city || state.activeCity || ''),
    title: String(route.title || 'Saved route').trim().slice(0, 100),
    notes: String(route.notes || '').trim().slice(0, 2000),
    icon: String(route.icon || 'route').trim().slice(0, 30),
    color: /^#[0-9a-f]{6}$/i.test(route.color || '') ? route.color : '#173c35',
    routeMode: String(route.routeMode || 'round-trip'), coordinates,
    destination: route.destination && Number.isFinite(Number(route.destination.lat)) && Number.isFinite(Number(route.destination.lng)) ? { lat: Number(route.destination.lat), lng: Number(route.destination.lng) } : null,
    createdAt: route.createdAt || now, updatedAt: now, saved: true
  };
}

export async function savePlannedRoute(plan, fields = {}) {
  const route = normalizeSavedRoute({ ...plan, ...fields, id: fields.id || null, coordinates: plan.coordinates });
  await db.put('saved_routes', route);
  state.savedRoutes = [...state.savedRoutes.filter((item) => item.id !== route.id), route];
  window.dispatchEvent(new CustomEvent('saved-routes-changed'));
  return route;
}

export async function updateSavedRoute(id, fields = {}) {
  const existing = state.savedRoutes.find((route) => route.id === id);
  if (!existing) return null;
  return savePlannedRoute(existing, { ...fields, id });
}

export async function deleteSavedRoute(id) {
  await db.remove('saved_routes', id);
  state.savedRoutes = state.savedRoutes.filter((route) => route.id !== id);
  window.dispatchEvent(new CustomEvent('saved-routes-changed'));
}
