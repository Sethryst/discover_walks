import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { el, sitesForProfile, cityLabel, escapeHtml, shortDate, normalizeProfile } from './utils.js';
import db from './storage.js';
import { renderGeofenceCategoryChips } from './ui.js';
import { renderFavoriteRegions } from './region-favorites.js';

export function renderProfile() {
  const profile = state.profile; const cityDiscoveries = sitesForProfile(profile).length;
  const nameInput = el('deviceProfileNameInput');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = profile.name || '';
  const stats = el('deviceProfileStats');
  if (stats) stats.innerHTML = `<span><strong>${Number(profile.walksCompleted || 0)}</strong><small>walks</small></span><span><strong>${Number(profile.observationsLogged || 0)}</strong><small>observations</small></span><span><strong>${cityDiscoveries}</strong><small>places learned</small></span><span><strong>${Number(profile.milesTotal || 0).toFixed(1)}</strong><small>miles</small></span>`;
  if (el('geofenceToggle')) el('geofenceToggle').checked = state.settings.enableGeofencing !== false;
  if (el('geofenceOptionsContainer')) el('geofenceOptionsContainer').classList.toggle('hidden', state.settings.enableGeofencing === false);
  if (el('geofenceRadiusSelect')) el('geofenceRadiusSelect').value = String(state.settings.defaultGeofenceRadiusMeters || 50);
  const favorites = new Set(state.settings.favoriteCategories || []);
  if (el('favoriteCategoryChips')) el('favoriteCategoryChips').innerHTML = GEOFENCE_CATEGORIES.map(([id, label]) => `<button type="button" class="poi-chip ${favorites.has(id) ? 'active' : ''}" data-favorite-category="${id}">${label}</button>`).join('');
  renderGeofenceCategoryChips();
  void renderFavoriteRegions(state.settings);
  const avatar = el('profileAvatarButton');
  if (avatar) {
    const signedIn = Boolean(state.online.session);
    avatar.classList.remove('hidden');
    el('profileAvatarGlyph').textContent = state.profile.avatarIcon || '✦';
    const image = el('profileAvatarImage'); image.src = state.profile.avatarImage || '';
    image.classList.toggle('hidden', !state.profile.avatarImage);
    el('profileAvatarGlyph').classList.toggle('hidden', Boolean(state.profile.avatarImage));
    el('profileAvatarSettings')?.classList.remove('hidden');
  }
}

export async function setProfileAvatar({ icon = null, image = null } = {}) {
  state.profile = normalizeProfile({ ...state.profile, avatarIcon: icon || state.profile.avatarIcon || '✦', avatarImage: image || null });
  await db.put('profile', state.profile);
  renderProfile();
}

export async function updateProfile(mutator) {
  const result = await mutator(state.profile);
  state.profile = normalizeProfile(state.profile);
  await db.put('profile', state.profile);
  renderProfile();
  if (state.online.session) import('./online.js').then(({ syncProfile }) => syncProfile().catch(() => {})).catch(() => {});
  // Go online uploads selected, encrypted classes only. Updating a local walk
  // or observation must not separately upload unencrypted activity totals.
  return result;
}
