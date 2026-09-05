export const HOME_FILTER_TAGS = ['community', 'facility', 'library', 'recreation_center', 'pantry', 'wifi'];

const CATEGORY_FILTER_TAGS = {
  accessibility: ['community'],
  accessible_place: ['community'],
  government_center: ['community'],
  townhall: ['community'],
  civic: ['community'],
  police: ['community'],
  fire_station: ['community'],
  hospital: ['community'],
  clinic: ['community'],
  doctors: ['community'],
  pharmacy: ['community'],
  school: ['community'],
  university: ['community'],
  college: ['community'],
  kindergarten: ['community'],
  post_office: ['community'],
  bank: ['community'],
  place_of_worship: ['community'],
  hotel: ['community'],
  information: ['community'],
  toilets: ['restrooms'],
  toilet: ['restrooms'],
  viewpoint: ['park', 'nature'],
  scenic: ['park', 'nature'],
  picnic_site: ['park', 'shelter'],
  attraction: ['park'],
  plant: ['nature', 'garden'],
  birding_hotspot: ['wildlife', 'nature'],
  museum: ['history', 'history_museum'],
  artwork: ['public_art', 'art'],
  memorial: ['history', 'history_monument'],
  fountain: ['water'],
  well: ['water'],
  stream: ['water'],
  beach: ['park', 'water'],
  maritime: ['water'],
  estuary: ['water'],
  route: ['trail'],
  footway: ['trail'],
  path: ['trail'],
  pedestrian: ['trail'],
  swimming_pool: ['park'],
  sports_centre: ['recreation_center']
};

const KNOWN_FILTER_TAGS = new Set([
  ...HOME_FILTER_TAGS,
  'park', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad',
  'rest', 'restrooms', 'drinking_water', 'water_fountain', 'shelter', 'bench', 'trail',
  'history', 'history_landmark', 'history_monument', 'history_museum', 'history_cemetery', 'history_marker',
  'art', 'public_art', 'coffee', 'coffee_shop', 'cafe', 'market', 'farmers_market', 'grocery', 'supermarket', 'convenience',
  'restaurant', 'fast_food', 'event', 'news', 'osm', 'parking', 'bicycle_parking', 'bike_rack'
]);

function addTag(tags, tag) {
  if (tag && !tags.includes(tag)) tags.push(tag);
}

export function applyRegionFilterTags(poi, tags = [], isFoodFilterTag = () => false) {
  const next = [...tags];
  const keys = [poi.category, poi.type, poi.subcategory].map((value) => String(value || '').toLowerCase().replace(/\s+/g, '_'));
  keys.forEach((key) => (CATEGORY_FILTER_TAGS[key] || []).forEach((tag) => addTag(next, tag)));
  const hasKnown = next.some((tag) => KNOWN_FILTER_TAGS.has(tag) || String(tag).startsWith('history_') || isFoodFilterTag(tag));
  if (!hasKnown) addTag(next, 'community');
  return next;
}

export function assignPoiHome(poi, cityId) {
  return String(poi?.home || poi?.city || poi?.packId || cityId || '');
}
