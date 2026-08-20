import { poiTags } from './poi.js';

export const DISCOVER_GROUPS = [
  { id: 'explore', label: 'Places to Explore', icon: '⌁', tags: ['park', 'trail', 'nature', 'water', 'water_access', 'scenic', 'community_garden', 'playground'] },
  { id: 'heritage', label: 'History & Heritage', icon: '✦', tags: ['history', 'history_landmark', 'history_monument', 'history_museum', 'history_cemetery', 'history_marker'] },
  { id: 'culture', label: 'Art & Culture', icon: '◇', tags: ['art', 'public_art', 'music'] },
  { id: 'community', label: 'Food & Community', icon: '●', tags: ['coffee', 'community', 'library', 'pantry', 'recreation_center'] }
];

export function publishingState(poi) {
  if (poi.publishingState) return poi.publishingState;
  return poi.unverified || poi.reviewFlagged ? 'candidate' : poi.featured || poi.curated ? 'featured' : 'published';
}

export function discoverGroupFor(poi) {
  const tags = poiTags(poi);
  return DISCOVER_GROUPS.find((group) => group.tags.some((tag) => tags.includes(tag))) || DISCOVER_GROUPS[0];
}

export function rankDiscoverPlaces(places) {
  const rank = { featured: 0, published: 1, candidate: 2 };
  return [...places].sort((a, b) => (rank[publishingState(a)] ?? 2) - (rank[publishingState(b)] ?? 2) || String(a.name || '').localeCompare(String(b.name || '')));
}
