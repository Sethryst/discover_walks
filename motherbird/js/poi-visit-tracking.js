import { state } from './state.js';
import { updateProfile } from './profile.js';

export function visitedPoiIds(profile = state.profile) { return new Set(profile?.visitedPoiIds || []); }
export function isPoiVisited(poi, profile = state.profile) { return Boolean(poi?.id && visitedPoiIds(profile).has(String(poi.id))); }
export async function setPoiVisited(poi, visited = true) {
  if (!poi?.id) return false;
  await updateProfile((profile) => {
    const ids = new Set(profile.visitedPoiIds || []);
    if (visited) ids.add(String(poi.id));
    else ids.delete(String(poi.id));
    profile.visitedPoiIds = [...ids];
  });
  globalThis.window?.dispatchEvent(new CustomEvent('poi-visit-state-changed'));
  return Boolean(visited);
}

export async function markPoiVisited(poi) {
  return setPoiVisited(poi, true);
}
