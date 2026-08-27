import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { el, sitesForProfile, cityLabel, escapeHtml, shortDate, normalizeProfile } from './utils.js';
import { syncProfile } from './online.js';
import db from './storage.js';
import { renderGeofenceCategoryChips } from './ui.js';
import { renderFavoriteRegions } from './region-favorites.js';

export function renderProfile() {
  const profile = state.profile; const cityDiscoveries = sitesForProfile(profile).length;
  el('profileStats').innerHTML = [
    [profile.walksCompleted, 'Walks completed'], [profile.milesTotal.toFixed(1), 'Miles total'],
    [cityDiscoveries, 'Places remembered'], [profile.observationsLogged, 'Observations']
  ].map(([value, label]) => `<div class="profile-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  el('journalSummary').textContent = `${profile.observationsLogged} observations · ${profile.walksCompleted} walks · ${cityDiscoveries} places remembered`;
  el('profileRecordLead').textContent = profile.walksCompleted || profile.observationsLogged || cityDiscoveries ? 'Your local walking story.' : 'A blank page is welcome.';
  el('profileRecordDetail').textContent = profile.walksCompleted || profile.observationsLogged || cityDiscoveries ? 'These are your memories—not a score. They stay on this device unless you choose otherwise.' : 'Start with one walk, observation, or reflection. It stays on this device unless you choose otherwise.';
  const select = el('citySelect');
  const grouped = {};
  Object.entries(CITIES).forEach(([id, item]) => {
    if (!grouped[item.state]) grouped[item.state] = [];
    grouped[item.state].push([id, item]);
  });
  select.innerHTML = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stateCode, cities]) => `<optgroup label="${escapeHtml(stateCode)}">${cities.map(([id]) => `<option value="${id}">${escapeHtml(cityLabel(id))}</option>`).join('')}</optgroup>`)
    .join('');
  select.value = state.activeCity;
  if (el('geofenceToggle')) el('geofenceToggle').checked = state.settings.enableGeofencing !== false;
  if (el('geofenceOptionsContainer')) el('geofenceOptionsContainer').classList.toggle('hidden', state.settings.enableGeofencing === false);
  if (el('geofenceRadiusSelect')) el('geofenceRadiusSelect').value = String(state.settings.defaultGeofenceRadiusMeters || 50);
  const favorites = new Set(state.settings.favoriteCategories || []);
  el('favoriteCategoryChips').innerHTML = GEOFENCE_CATEGORIES.map(([id, label]) => `<button type="button" class="poi-chip ${favorites.has(id) ? 'active' : ''}" data-favorite-category="${id}">${label}</button>`).join('');
  renderGeofenceCategoryChips();
  const onlineName = state.online.remoteProfile?.username;
  el('onlineTeaserTitle').textContent = onlineName ? `Optional profile: @${onlineName}` : 'Stay local by default';
  el('onlineTeaserText').textContent = onlineName ? `Last aggregate sync: ${state.settings.lastSyncedAt ? shortDate(state.settings.lastSyncedAt) : 'not yet'}. Routes, observations, photos, and notes remain local.` : 'Optional online mode maintains only a minimal aggregate profile. Routes, observations, photos, and notes never leave this device.';
  void renderFavoriteRegions(state.settings);
}

export async function updateProfile(mutator) {
  const result = await mutator(state.profile);
  state.profile = normalizeProfile(state.profile);
  await db.put('profile', state.profile);
  renderProfile();
  void syncProfile().catch((error) => console.warn('Aggregate profile sync deferred:', error.message));
  return result;
}
