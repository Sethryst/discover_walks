import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { el, sitesForProfile, cityLabel, escapeHtml, shortDate, normalizeProfile } from './utils.js';
import { syncProfile } from './online.js';
import { cityDiscoverableSites } from './poi.js';
import db from './storage.js';
import { badge, renderGeofenceCategoryChips } from './ui.js';
import { fieldEditionStatus } from './entitlements.js';
import { renderFavoriteRegions } from './region-favorites.js';

export function renderProfile() {
  const profile = state.profile; const cityDiscoveries = sitesForProfile(profile).length; const totalCitySites = cityDiscoverableSites().length;
  el('profilePoints').textContent = Math.round(profile.totalPoints).toLocaleString();
  el('profileStats').innerHTML = [
    [profile.walksCompleted, 'Walks completed'], [profile.milesTotal.toFixed(1), 'Miles total'],
    [`${cityDiscoveries}/${totalCitySites}`, `${CITIES[state.activeCity].name} sites`], [profile.observationsLogged, 'Observations'], [profile.streakDays, 'Day streak']
  ].map(([value, label]) => `<div class="profile-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  el('badgeList').innerHTML = [
    badge('First Steps', profile.walksCompleted >= 1, 'Complete one walk.'),
    badge('Explorer', totalCitySites > 0 && cityDiscoveries >= totalCitySites, `Discover every stop in ${cityLabel(state.activeCity)}.`),
    badge('Century Club', profile.totalPoints >= 100, 'Earn 100 total trail points.'),
    badge('Naturalist', profile.observationsLogged >= 10, 'Log 10 nature observations.')
  ].join('');
  el('profileNextMilestone').textContent = profile.walksCompleted < 1 ? 'Complete a walk to earn First Steps.' : profile.totalPoints < 100 ? `${Math.max(0, 100 - Math.round(profile.totalPoints))} points to Century Club.` : 'Your local trail story is growing.';
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
  el('onlineTeaserTitle').textContent = onlineName ? `Online as @${onlineName}` : 'Stay local by default';
  el('onlineTeaserText').textContent = onlineName ? `Last aggregate sync: ${state.settings.lastSyncedAt ? shortDate(state.settings.lastSyncedAt) : 'not yet'}. Routes, observations, photos, and notes remain local.` : 'Optional online mode shares only aggregate points and miles with friends—never routes, observations, photos, or notes.';
  el('fieldEditionStatus').textContent = fieldEditionStatus();
  el('fieldEditionDetail').textContent = state.settings.entitlements?.fieldEdition || state.settings.entitlements?.partnerGrants?.length ? 'Offline Field Editions are available for the regions you can access.' : 'Your walks and reflections are always yours.';
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
