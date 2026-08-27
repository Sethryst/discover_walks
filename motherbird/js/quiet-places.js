import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { isOsmPoi, poiTags } from './poi.js';

export async function quietPlacesNear(cityId, origin) {
  // Normal application behavior uses the validated offline package and never
  // contacts Overpass. These remain route-supportive candidates, not encounters.
  return (state.cityPois[cityId] || [])
    .filter(isOsmPoi)
    .filter((poi) => poi.name && Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .filter((poi) => poiTags(poi).some((tag) => ['park', 'nature', 'community_garden', 'water', 'water_access', 'trail'].includes(tag)))
    .map((poi) => ({ ...poi, distance: distanceMeters(origin, poi) }))
    .filter((poi) => poi.distance <= 2800)
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
    .slice(0, 40)
    .map(({ distance: _distance, ...poi }) => poi);
}
