import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { el, sitesForProfile, cityLabel, escapeHtml, shortDate, normalizeProfile } from './utils.js';
import db from './storage.js';
import { renderGeofenceCategoryChips } from './ui.js';
import { renderFavoriteRegions } from './region-favorites.js';

export function renderProfile() {
  const profile = state.profile; const cityDiscoveries = sitesForProfile(profile).length;
  if (el('geofenceToggle')) el('geofenceToggle').checked = state.settings.enableGeofencing !== false;
  if (el('geofenceOptionsContainer')) el('geofenceOptionsContainer').classList.toggle('hidden', state.settings.enableGeofencing === false);
  if (el('geofenceRadiusSelect')) el('geofenceRadiusSelect').value = String(state.settings.defaultGeofenceRadiusMeters || 50);
  const favorites = new Set(state.settings.favoriteCategories || []);
  if (el('favoriteCategoryChips')) el('favoriteCategoryChips').innerHTML = GEOFENCE_CATEGORIES.map(([id, label]) => `<button type="button" class="poi-chip ${favorites.has(id) ? 'active' : ''}" data-favorite-category="${id}">${label}</button>`).join('');
  renderGeofenceCategoryChips();
  void renderFavoriteRegions(state.settings);
}

export async function updateProfile(mutator) {
  const result = await mutator(state.profile);
  state.profile = normalizeProfile(state.profile);
  await db.put('profile', state.profile);
  renderProfile();
  // Go online uploads selected, encrypted classes only. Updating a local walk
  // or observation must not separately upload unencrypted activity totals.
  return result;
}
