import { distanceMeters } from './geo.js';
import { state } from './state.js';
import { isWalkablePoi, poiTags, showHistory } from './poi.js';
import { requestCompanionContext } from './companion.js';
import { mergeExplorePois } from './learn-explore.js';
import db from './storage.js';

export function checkGeofences(point) {
  void mergeExplorePois().then(() => checkGeofencesNow(point));
}

function checkGeofencesNow(point) {
  const settings = state.settings || {};
  if (settings.enableGeofencing === false) return;
  if (state.activeWalk && (state.activeWalk.discoveryCount || 0) >= 2) return;
  const enabledStars = new Set(settings.geofenceCategories || ['news', 'recreation', 'cuisine']);
  const favorites = new Set(settings.favoriteCategories || []);
  const defaultRadius = settings.defaultGeofenceRadiusMeters || 50;
  const pois = state.cityPois[state.activeCity] || [];
  const nearby = pois
    .filter((poi) => {
    if (!isWalkablePoi(poi)) return false;
    const tags = poiTags(poi);
    const recreation = tags.some((tag) => ['park', 'trail', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad', 'history', 'rest'].includes(tag) || tag.startsWith('history_'));
    const cuisine = tags.some((tag) => ['coffee', 'coffee_shop', 'cafe', 'market', 'farmers_market', 'grocery', 'supermarket', 'convenience', 'restaurant', 'fast_food'].includes(tag));
    const news = tags.some((tag) => ['event', 'news', 'community', 'civic'].includes(tag)) || poi.light === 'news';
    const allowed = (news && enabledStars.has('news') && state.layerLights.news)
      || (recreation && enabledStars.has('recreation') && state.layerLights.recreation)
      || (cuisine && enabledStars.has('cuisine') && state.layerLights.cuisine);
    if (!allowed) return false;
    if (state.prompted.has(`${state.activeCity}:${poi.id}`)) return false;
    const effectiveRadius = poi.radius || defaultRadius;
    return distanceMeters(point, poi) <= effectiveRadius;
    })
    .map((poi) => {
      const tags = poiTags(poi);
      const distance = distanceMeters(point, poi);
      const relevance = tags.filter((tag) => favorites.has(tag)).length * 100 + (tags.includes('history') ? 20 : 0) - distance;
      return { poi, distance, relevance };
    })
    .sort((a, b) => b.relevance - a.relevance)[0];
  if (nearby && state.activeWalk) {
    const tags = poiTags(nearby.poi);
    requestCompanionContext(tags.some((tag) => ['water', 'water_access', 'river', 'lake'].includes(tag)) ? 'water' : tags.some((tag) => tag === 'history' || tag.startsWith('history_')) ? 'historic' : tags.some((tag) => ['wildlife', 'nature'].includes(tag)) ? 'observe' : 'discover');
    globalThis.window?.dispatchEvent(new CustomEvent('walk-poi-encounter', { detail: nearby }));
  }
  if (nearby && !state.modalOpen) {
    if (state.activeWalk) state.activeWalk.discoveryCount = (state.activeWalk.discoveryCount || 0) + 1;
    if (settings.autoJournalGeofences !== false) {
      const id = `geofence:${state.activeCity}:${nearby.poi.id}`;
      void db.put('moments', { id, type: 'journal', city: state.activeCity, title: `Encountered ${nearby.poi.name || 'a nearby place'}`, note: `Automatically added from a geofence encounter. Distance: ${Math.round(nearby.distance)} m.`, poiId: nearby.poi.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), geofence: true });
      globalThis.window?.dispatchEvent(new CustomEvent('journal-data-changed'));
    }
    void showHistory(nearby.poi, nearby.distance);
  }
}
