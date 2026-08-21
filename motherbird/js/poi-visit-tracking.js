import { state } from './state.js';
import { updateProfile } from './profile.js';

export function visitedPoiIds(profile = state.profile) { return new Set(profile?.visitedPoiIds || []); }
export function isPoiVisited(poi, profile = state.profile) { return Boolean(poi?.id && visitedPoiIds(profile).has(String(poi.id))); }
export async function markPoiVisited(poi) {
  if (!poi?.id) return false;
  let added = false;
  await updateProfile((profile) => {
    const ids = new Set(profile.visitedPoiIds || []);
    added = !ids.has(String(poi.id));
    ids.add(String(poi.id));
    profile.visitedPoiIds = [...ids];
  });
  globalThis.window?.dispatchEvent(new CustomEvent('poi-visit-state-changed'));
  return added;
}
