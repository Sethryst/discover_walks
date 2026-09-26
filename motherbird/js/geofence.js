import { distanceMeters } from './geo.js';
import { state } from './state.js';
import { isWalkablePoi, poiTags, showHistory } from './poi.js';
import { requestCompanionContext } from './companion.js';
import { mergeExplorePois } from './learn-explore.js';
import db from './storage.js';
import { quoteContextForPoi, suggestContextualQuote } from './quote-context.js';

export function checkGeofences(point) {
  void mergeExplorePois().then(() => checkGeofencesNow(point));
}

function checkGeofencesNow(point) {
  const settings = state.settings || {};
  if (settings.enableGeofencing === false) return;
  const defaultRadius = settings.defaultGeofenceRadiusMeters || 50;
  const pois = state.cityPois[state.activeCity] || [];
  const nearby = pois
    .filter((poi) => {
    if (!isWalkablePoi(poi)) return false;
    if (state.prompted.has(`${state.activeCity}:${poi.id}`)) return false;
    const effectiveRadius = poi.radius || defaultRadius;
    return distanceMeters(point, poi) <= effectiveRadius;
    })
    .map((poi) => {
      const distance = distanceMeters(point, poi);
      return { poi, distance };
    });
  nearby.forEach((encounter) => {
    const key = `${state.activeCity}:${encounter.poi.id}`;
    state.prompted.add(key);
    if (state.activeWalk) {
      const tags = poiTags(encounter.poi);
      requestCompanionContext(tags.some((tag) => ['water', 'water_access', 'river', 'lake'].includes(tag)) ? 'water' : tags.some((tag) => tag === 'history' || tag.startsWith('history_')) ? 'historic' : tags.some((tag) => ['wildlife', 'nature'].includes(tag)) ? 'observe' : 'discover');
      globalThis.window?.dispatchEvent(new CustomEvent('walk-poi-encounter', { detail: encounter }));
      const context = quoteContextForPoi(encounter.poi);
      if (context) void suggestContextualQuote({ ...context, poi: encounter.poi, eventId: encounter.poi.id });
    }
    if (settings.autoJournalGeofences !== false) {
      const id = `geofence:${state.activeCity}:${encounter.poi.id}`;
      void db.put('moments', { id, type: 'journal', city: state.activeCity, title: `Encountered ${encounter.poi.name || 'a nearby place'}`, note: `Automatically added from a geofence encounter. Distance: ${Math.round(encounter.distance)} m.`, poiId: encounter.poi.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), geofence: true });
      globalThis.window?.dispatchEvent(new CustomEvent('journal-data-changed'));
    }
    void showHistory(encounter.poi, encounter.distance);
  });
}
