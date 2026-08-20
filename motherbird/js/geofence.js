import { distanceMeters } from './geo.js';
import { state } from './state.js';
import { GEOFENCE_CATEGORIES } from './constants.js';
import { geofenceCategoriesForCity, isWalkablePoi, poiTags, showHistory } from './poi.js';

export function checkGeofences(point) {
  const settings = state.settings || {};
  if (settings.enableGeofencing === false) return;
  // A walk is a chance to notice, not a scavenger hunt.  Keep the live
  // experience intentionally small; direct map exploration remains unlimited.
  if (state.activeWalk && (state.activeWalk.discoveryCount || 0) >= 2) return;
  const configuredCategories = geofenceCategoriesForCity();
  const enabledCategories = new Set(settings.geofenceCategories || (configuredCategories.length ? configuredCategories : GEOFENCE_CATEGORIES).map(([id]) => id));
  const favorites = new Set(settings.favoriteCategories || []);
  const defaultRadius = settings.defaultGeofenceRadiusMeters || 50;
  const pois = state.cityPois[state.activeCity] || [];
  const nearby = pois
    .filter((poi) => {
    if (!isWalkablePoi(poi)) return false;
    const tags = poiTags(poi);
    if (!tags.some((tag) => enabledCategories.has(tag))) return false;
    if (state.prompted.has(`${state.activeCity}:${poi.id}`)) return false;
    const effectiveRadius = poi.radius || defaultRadius;
    return distanceMeters(point, poi) <= effectiveRadius;
    })
    .map((poi) => {
      const tags = poiTags(poi);
      const distance = distanceMeters(point, poi);
      // Personal interests provide a gentle nudge, while distance prevents a
      // less relevant place from winning merely because it has many tags.
      const relevance = tags.filter((tag) => favorites.has(tag)).length * 100 + (tags.includes('history') ? 20 : 0) - distance;
      return { poi, distance, relevance };
    })
    .sort((a, b) => b.relevance - a.relevance)[0];
  if (nearby && !state.modalOpen) {
    if (state.activeWalk) state.activeWalk.discoveryCount = (state.activeWalk.discoveryCount || 0) + 1;
    showHistory(nearby.poi, nearby.distance);
  }
}
