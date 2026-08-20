import {
  DEFAULT_PROFILE,
  CITIES,
  POINTS_PER_MILE,
  STREAK_BONUS_PER_DAY,
  MAX_GPS_ACCURACY_METERS,
  MAX_WALK_SPEED_MPS,
  POI_TAGS,
  TAG_LABELS,
  POI_TAG_PRIORITY,
  POI_ICONS,
  HISTORY_SUBTYPES,
  GEOFENCE_CATEGORIES
} from './constants.js';

import { state } from './state.js';
export function el(id) {
  return document.getElementById(id);
}
export function cityLabel(cityId) {
  const config = CITIES[cityId];
  if (!config) return '';
  return `${config.name}, ${config.state}`;
}
export function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
export function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
export function formatDistance(meters) { return (meters / 1609.344).toFixed(meters < 160 ? 2 : 1); }
export function formatDuration(seconds) { const min = Math.floor(seconds / 60); return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
export function shortDate(value) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }
export function dayKey(date = new Date()) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function previousDayKey(key) { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() - 1); return dayKey(d); }
export function escapeHtml(text) { return String(text || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
export function normalizeProfile(raw = {}) {
  const sites = Array.isArray(raw.sitesDiscovered) ? { vienna: raw.sitesDiscovered } : (raw.sitesDiscovered || {});
  const normalizedSites = {};
  Object.entries(sites).forEach(([key, ids]) => { normalizedSites[key] = [...new Set(Array.isArray(ids) ? ids : [])]; });
  return {
    ...DEFAULT_PROFILE, ...raw, id: 'local-user', totalPoints: Number(raw.totalPoints) || 0,
    walksCompleted: Number(raw.walksCompleted) || 0, milesTotal: Number(raw.milesTotal) || 0,
    observationsLogged: Number(raw.observationsLogged) || 0, streakDays: Number(raw.streakDays) || 0,
    sitesDiscovered: normalizedSites
  };
}
export function sitesForProfile(profile, cityId = state.activeCity) { return profile.sitesDiscovered[cityId] || []; }
export function totalSitesDiscovered(profile) { return Object.values(profile.sitesDiscovered).reduce((total, ids) => total + ids.length, 0); }
export function localObservationCity(observation) { return observation.city || 'vienna'; }
