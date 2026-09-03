import { HISTORY_SUBTYPES, POI_ICONS, POI_TAG_PRIORITY } from './constants.js';

// Keep this allow-list in step with motherbird/icons/. Marker glyphs are CSS
// masks, so an invalid id would otherwise silently produce a blank pin.
export const ICON_IDS = new Set([
  'anchor', 'bench', 'book-open', 'bookmark', 'building', 'coffee', 'droplet',
  'eye', 'map-pin', 'star', 'tree', 'utensils', 'walk'
]);

// Shared tag-to-icon map for the map layer and the filter sheet. POI_ICONS is
// intentionally checked first by markerIconId; this fills the tags that are
// supplied by amenities or regional packs rather than the core POI taxonomy.
export const ICONS = {
  ...POI_ICONS,
  park: 'tree', nature: 'tree', garden: 'tree', community_garden: 'tree',
  playground: 'tree', dog_park: 'tree', shelter: 'tree',
  wildlife: 'eye', rest: 'building', restrooms: 'building', bench: 'bench',
  drinking_water: 'droplet', water_fountain: 'droplet', water: 'droplet',
  water_access: 'anchor', trail: 'walk',
  history: 'bookmark', monument: 'bookmark', marker: 'bookmark',
  landmark: 'building', museum: 'book-open', cemetery: 'map-pin',
  art: 'star', public_art: 'star',
  coffee: 'coffee', cafe: 'coffee', coffee_shop: 'coffee',
  market: 'utensils', farmers_market: 'utensils', grocery: 'utensils',
  supermarket: 'utensils', restaurant: 'utensils', fast_food: 'utensils',
  event: 'star', news: 'star',
  waste_basket: 'trash-2', trash: 'trash-2', accessible_parking: 'parking',
  mexican: 'utensils', filipino: 'utensils', food_cart: 'utensils', bakery: 'utensils',
  parking: 'parking', bicycle_parking: 'bike', bike_rack: 'bike', osm: 'map'
};

export const MARKER_COLORS = {
  nature: '#2d7259', water: '#287a78', trail: '#4b7f44',
  historic: '#65783b', cuisine: '#c65d0e', cuisineMarket: '#d47b19', cuisineRestaurant: '#a94710', news: '#8b3a4a',
  personal: '#76558b', fallback: '#2d7259'
};

const CHIP_ICON_IDS = {
  routes: 'walk', nature: 'tree', trails: 'walk', historic: 'bookmark',
  cafes: 'coffee', markets: 'utensils', restaurants: 'utensils'
};

const CHIP_COLORS = {
  routes: MARKER_COLORS.trail, nature: MARKER_COLORS.nature,
  trails: MARKER_COLORS.trail, historic: MARKER_COLORS.historic,
  cafes: MARKER_COLORS.cuisine, markets: MARKER_COLORS.cuisineMarket,
  restaurants: MARKER_COLORS.cuisineRestaurant
};

const MARKER_TAGS = new Set([
  'park', 'nature', 'garden', 'community_garden', 'playground', 'dog_park', 'shelter',
  'wildlife', 'rest', 'restrooms', 'bench', 'drinking_water', 'water_fountain', 'water',
  'water_access', 'trail', 'history', 'monument', 'marker', 'landmark', 'museum', 'cemetery',
  'art', 'public_art', 'coffee', 'cafe', 'coffee_shop', 'market', 'farmers_market', 'grocery',
  'supermarket', 'restaurant', 'fast_food', 'event', 'news'
]);

function validIconId(id) { return ICON_IDS.has(id) ? id : null; }

function historySubtypeFrom(poi, tags = []) {
  const taggedSubtype = tags.find((tag) => String(tag).startsWith('history_'))?.slice('history_'.length);
  return poi?.historySubtype || taggedSubtype || null;
}

// This is deliberately ordered: history subtype, then the shared tag
// priority, then a collection icon for MY PLACES, then the pin fallback.
export function markerIconId({ poi = null, tags = [], collectionIcon = null } = {}) {
  const subtype = historySubtypeFrom(poi, tags);
  const historyIcon = validIconId(HISTORY_SUBTYPES[subtype]?.icon);
  if (historyIcon) return historyIcon;

  const tag = POI_TAG_PRIORITY.find((candidate) => MARKER_TAGS.has(candidate) && tags.includes(candidate));
  const tagIcon = validIconId(POI_ICONS[tag]) || validIconId(ICONS[tag]);
  if (tagIcon) return tagIcon;

  return validIconId(collectionIcon) || 'map-pin';
}

function colorForIcon(iconId) {
  if (['anchor', 'droplet'].includes(iconId)) return MARKER_COLORS.water;
  if (iconId === 'walk') return MARKER_COLORS.trail;
  if (['bookmark', 'building', 'book-open'].includes(iconId)) return MARKER_COLORS.historic;
  if (['coffee', 'utensils'].includes(iconId)) return MARKER_COLORS.cuisine;
  if (iconId === 'eye' || iconId === 'tree' || iconId === 'bench') return MARKER_COLORS.nature;
  return MARKER_COLORS.fallback;
}

function colorForTags(tags, poi) {
  if (tags.includes('event') || tags.includes('news')) return MARKER_COLORS.news;
  if (historySubtypeFrom(poi, tags) || tags.some((tag) => ['monument', 'marker', 'landmark', 'museum', 'cemetery', 'art', 'public_art'].includes(tag))) return MARKER_COLORS.historic;
  if (tags.some((tag) => ['coffee', 'cafe', 'coffee_shop'].includes(tag))) return MARKER_COLORS.cuisine;
  if (tags.some((tag) => ['market', 'farmers_market', 'grocery', 'supermarket'].includes(tag))) return MARKER_COLORS.cuisineMarket;
  if (tags.some((tag) => ['restaurant', 'fast_food'].includes(tag))) return MARKER_COLORS.cuisineRestaurant;
  if (tags.some((tag) => ['drinking_water', 'water_fountain', 'water', 'water_access'].includes(tag))) return MARKER_COLORS.water;
  if (tags.includes('trail')) return MARKER_COLORS.trail;
  if (tags.some((tag) => ['rest', 'restrooms'].includes(tag))) return MARKER_COLORS.nature;
  return colorForIcon(markerIconId({ poi, tags }));
}

export function markerVisual({ poi = null, tags = [], light = null, chipId = null, collectionIcon = null, collectionColor = null } = {}) {
  if (light === 'personal') return { iconId: validIconId(collectionIcon) || 'map-pin', color: /^#[0-9a-f]{6}$/i.test(collectionColor || '') ? collectionColor : MARKER_COLORS.personal };
  if (light === 'news') return { iconId: 'star', color: MARKER_COLORS.news };

  // User-posted recreation/cuisine pins have only a chip, not POI tags.
  const chipIcon = validIconId(CHIP_ICON_IDS[chipId]);
  if (chipIcon) return { iconId: chipIcon, color: CHIP_COLORS[chipId] || colorForIcon(chipIcon) };

  const iconId = markerIconId({ poi, tags, collectionIcon });
  return { iconId, color: colorForTags(tags, poi) };
}

export function markerPinHtml(visual) {
  const iconId = validIconId(visual?.iconId) || 'map-pin';
  const color = visual?.color || MARKER_COLORS.fallback;
  return `<div class="poi-marker" style="--marker-color:${color}"><span class="poi-marker-glyph poi-icon-${iconId}" aria-hidden="true"></span></div>`;
}
