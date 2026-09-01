import { state } from './state.js';
import db from './storage.js';
import { availablePoiTags, isFoodFilterTag, isOsmPoi, isVisiblePoi, poiTags, renderCityPois } from './poi.js';
import { curatedPersonalPlaces, renderPersonalPlacesOnMap, upsertImportedPersonalData } from './personal-places.js';
import { el, escapeHtml } from './utils.js';
import { closeSheets, openSheet, toast } from './ui.js';
import { hydrateInlineIcons } from './icon-loader.js';
import { CITIES } from './constants.js';
import { routesForCity } from './routes.js';
import { refreshPublicMarkers } from './online.js';

export const LAYER_GROUPS = [
  { id: 'park_infrastructure', label: 'Park infrastructure', description: 'Comfort and access while you walk', tags: ['drinking_water', 'water_fountain', 'water', 'waste_basket', 'trash', 'bench', 'shelter', 'shade', 'restrooms', 'accessible_parking'] },
  { id: 'dining', label: 'Cuisine', description: 'Markets, restaurants, cafés, and quick stops', tags: ['market', 'farmers_market', 'restaurant', 'fast_food', 'mexican', 'filipino', 'coffee', 'coffee_shop', 'cafe', 'food_cart', 'bakery'] },
  { id: 'navigation', label: 'Navigation', description: 'Routes and ways to arrive', tags: ['trail', 'parking', 'bicycle_parking', 'bike_rack'] },
  { id: 'outdoors', label: 'Nature & outdoors', description: 'Green space, wildlife, and water access', tags: ['park', 'nature', 'wildlife', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad'] },
  { id: 'culture', label: 'History, art & culture', description: 'Public stories and creative places', tags: ['history', 'history_landmark', 'history_monument', 'history_museum', 'history_cemetery', 'history_marker', 'art', 'public_art'] },
  { id: 'community', label: 'Community & essentials', description: 'Public services and shared spaces', tags: ['community', 'facility', 'library', 'recreation_center', 'pantry', 'wifi'] },
  { id: 'activities', label: 'Sports & activities', description: 'Places to move and play', tags: ['basketball', 'tennis', 'disc_golf', 'skate_park'] },
  { id: 'more', label: 'More map layers', description: 'Additional regional categories', tags: ['event', 'osm', 'rest'] }
];

const STATIC_LABELS = {
  drinking_water: 'Water fountains', water_fountain: 'Water fountains', water: 'Water', waste_basket: 'Trash receptacles', trash: 'Trash receptacles', bench: 'Benches', shelter: 'Shade shelters', shade: 'Shade', restrooms: 'Restrooms', accessible_parking: 'Accessible parking', restaurant: 'Restaurants', fast_food: 'Quick-service food', mexican: 'Mexican food', filipino: 'Filipino food', coffee: 'Coffee shops', coffee_shop: 'Coffee shops', cafe: 'Cafés', food_cart: 'Food carts', bakery: 'Bakeries', trail: 'Trail markers', parking: 'Parking', bicycle_parking: 'Bike racks', bike_rack: 'Bike racks', osm: 'OpenStreetMap places'
};

const ICONS = {
  drinking_water: 'water-fountain', water_fountain: 'water-fountain', water: 'droplet', waste_basket: 'trash-2', trash: 'trash-2', bench: 'bench', shelter: 'tree', shade: 'tree', restrooms: 'building', accessible_parking: 'parking', restaurant: 'utensils', fast_food: 'utensils', mexican: 'utensils', filipino: 'utensils', coffee: 'coffee', coffee_shop: 'coffee', cafe: 'coffee', food_cart: 'utensils', bakery: 'utensils', trail: 'route', parking: 'parking', bicycle_parking: 'bike', bike_rack: 'bike', park: 'tree', nature: 'tree', wildlife: 'eye', water_access: 'anchor', community_garden: 'tree', history: 'bookmark', library: 'book-open', public_art: 'star', art: 'star', wifi: 'wifi', event: 'star', osm: 'map'
};

let searchQuery = '';
let pendingImport = null;
let civicAvailability = { news: false, volunteer: false, capability: 'none', notices: [] };
const CIVIC_VENUES = [
  { match: /fairfax county government center/i, lat: 38.8530, lng: -77.3574 },
  { match: /reston community center hunters woods/i, lat: 38.9367, lng: -77.3607 }
];

const LIGHT_CHIPS = {
  recreation: [
    { id: 'routes', label: 'routes', tags: ['__routes'] },
    { id: 'nature', label: 'nature', tags: ['park', 'nature', 'wildlife', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad'] },
    { id: 'trails', label: 'trails', tags: ['trail'] },
    { id: 'historic', label: 'historic', prefix: 'history' },
    { id: 'volunteer', label: 'volunteer', tags: ['__volunteer'] }
  ],
  cuisine: [
    { id: 'cafes', label: 'cafés', tags: ['coffee', 'coffee_shop', 'cafe'] },
    { id: 'markets', label: 'markets', tags: ['market', 'farmers_market', 'grocery', 'supermarket', 'convenience'] },
    { id: 'restaurants', label: 'restaurants', tags: ['restaurant', 'fast_food'] }
  ]
};

const MAP_TAGS = new Set([
  'event', '__routes', '__volunteer',
  ...LIGHT_CHIPS.recreation.flatMap((chip) => chip.tags || []),
  ...LIGHT_CHIPS.cuisine.flatMap((chip) => chip.tags || [])
]);

function isMapTag(id) { return MAP_TAGS.has(id) || String(id).startsWith('history'); }

export async function initLayerSystem() {
  const [savedFilters, savedUi] = await Promise.all([
    db.get('layer_settings', 'current-filters'), db.get('layer_settings', 'layer-ui-state')
  ]);
  state.layerFilters = { public: { ...(savedFilters?.public || {}) }, personal: { ...(savedFilters?.personal || {}) } };
  state.layerLights = { news: false, recreation: true, cuisine: false, personal: false, ...(savedFilters?.lights || {}) };
  state.layerUiState = { expanded: { ...(savedUi?.expanded || {}) } };
  civicAvailability = await loadCivicAvailability();
  if (savedFilters?.lights?.news == null) state.layerLights.news = newsAvailable();
  ensureLayerDefaults();
  syncLegacyPoiTags();
  bindLayerControls();
  renderLayerFilters();
  renderMapLights();
  renderNewsMarkers();
  renderRouteLights();
}

function buildAllLayerGroups() {
  const pois = (state.cityPois[state.activeCity] || []).filter(isVisiblePoi);
  const available = new Map(availablePoiTags(pois));
  const claimed = new Set();
  const groups = LAYER_GROUPS.map((group) => {
    const options = group.tags.filter((id) => available.has(id) || shouldShowEmptyStandard(id)).map((id) => {
      claimed.add(id);
      return publicOption(id, available.get(id), pois);
    });
    return { ...group, options };
  });
  const extras = [...available].filter(([id]) => !claimed.has(id));
  groups.find((group) => group.id === 'dining').options.push(...extras.filter(([id]) => isFoodFilterTag(id)).map(([id, label]) => publicOption(id, label, pois)));
  groups.find((group) => group.id === 'more').options.push(...extras.filter(([id]) => !isFoodFilterTag(id)).map(([id, label]) => publicOption(id, label, pois)));
  groups.push({
    id: 'personal_places', label: 'Personal places', description: 'Collections saved only on this device',
    options: state.personalPlaceCategories.map((category) => ({
      id: category.id, kind: 'personal', label: category.name, description: category.description || 'Custom collection',
      icon: category.icon, color: category.color, count: personalNearbyCount(category.id)
    }))
  });
  return groups.filter((group) => group.options.length || group.id === 'personal_places');
}

export function buildLayerGroups() {
  return buildAllLayerGroups().map((group) => ({
    ...group,
    options: group.options.filter((option) => option.kind === 'public' && !isMapTag(option.id) && !isFoodFilterTag(option.id))
  })).filter((group) => group.options.length);
}

function shouldShowEmptyStandard(id) {
  return false;
}

function publicOption(id, sourceLabel, pois) {
  return {
    id, kind: 'public', label: cleanLabel(sourceLabel || STATIC_LABELS[id] || titleCase(id)),
    description: `Public map places tagged ${titleCase(id)}`,
    icon: ICONS[id] || 'map-pin', color: publicColor(id),
    count: pois.filter((poi) => (id === 'osm' ? isOsmPoi(poi) : poiTags(poi).includes(id)) && inViewport(poi)).length
  };
}

function cleanLabel(label) { return String(label).replace(/^[^\p{L}\p{N}]+\s*/u, ''); }
function titleCase(value) { return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function publicColor(id) {
  if (/water/.test(id)) return '#0e7490';
  if (/trash|waste/.test(id)) return '#6b7280';
  if (/food|restaurant|mexican|filipino|coffee|cafe|bakery/.test(id)) return '#c65d0e';
  if (/history|art|museum|monument/.test(id)) return '#8b5cf6';
  if (/parking|bike|trail/.test(id)) return '#2563eb';
  return '#2d7259';
}

function inViewport(point) {
  if (!state.map) return true;
  try { return state.map.getBounds().contains([point.lat ?? point.location?.lat, point.lng ?? point.location?.lng]); } catch { return true; }
}

function personalNearbyCount(categoryId) {
  return curatedPersonalPlaces().filter((place) => (place.categoryId || place.category_id) === categoryId && inViewport(place.location)).length;
}

function ensureLayerDefaults() {
  for (const group of buildAllLayerGroups()) {
    if (!(group.id in state.layerUiState.expanded)) state.layerUiState.expanded[group.id] = true;
    for (const option of group.options) {
      const bucket = state.layerFilters[option.kind];
      if (!(option.id in bucket)) bucket[option.id] = option.kind === 'public' ? (option.id === 'event' ? state.layerLights.news : recreationTag(option.id)) : false;
    }
  }
  for (const id of ['__routes', '__volunteer']) if (!(id in state.layerFilters.public)) state.layerFilters.public[id] = id === '__routes';
}

function recreationTag(id) {
  return LIGHT_CHIPS.recreation.some((chip) => chip.prefix ? String(id).startsWith(chip.prefix) : chip.tags?.includes(id));
}

export function renderLayerFilters() {
  const root = el('poiTagFilters');
  if (!root) return;
  ensureLayerDefaults();
  const query = searchQuery.trim().toLowerCase();
  const groups = buildLayerGroups().map((group) => ({ ...group, options: group.options.filter((option) => !query || `${option.label} ${option.description}`.toLowerCase().includes(query)) })).filter((group) => group.options.length || (!query && group.id === 'personal_places'));
  root.innerHTML = groups.map((group) => {
    const expanded = state.layerUiState.expanded[group.id] !== false;
    const enabledCount = group.options.filter((option) => state.layerFilters[option.kind][option.id] !== false).length;
    const allEnabled = group.options.length > 0 && enabledCount === group.options.length;
    return `<section class="layer-filter-group" data-layer-group="${escapeHtml(group.id)}"><header><button class="layer-collapse" type="button" data-layer-collapse="${escapeHtml(group.id)}" aria-expanded="${expanded}"><span>${escapeHtml(group.label)}</span><small>${enabledCount}/${group.options.length}</small><b aria-hidden="true">⌄</b></button><label class="layer-toggle-all"><input type="checkbox" data-layer-toggle-all="${escapeHtml(group.id)}" ${allEnabled ? 'checked' : ''} ${group.options.length ? '' : 'disabled'} /> Toggle all</label></header><div class="layer-options ${expanded ? '' : 'hidden'}">${group.options.length ? group.options.map(renderLayerOption).join('') : '<p class="layer-empty">Create a personal collection to add it here.</p>'}</div></section>`;
  }).join('') || '<p class="layer-empty">No filters match that search.</p>';
  void hydrateInlineIcons(root);
  updateLayerStatus();
}

function renderLayerOption(option) {
  const enabled = state.layerFilters[option.kind][option.id] !== false;
  const countLabel = option.kind === 'personal' ? `${option.count} place${option.count === 1 ? '' : 's'}` : `${option.count} nearby`;
  return `<label class="layer-option" style="--layer-color:${escapeHtml(option.color)}"><input type="checkbox" data-layer-filter="${escapeHtml(option.kind)}:${escapeHtml(option.id)}" ${enabled ? 'checked' : ''} /><span class="layer-icon"><img data-inline-svg data-icon-fallback="" src="./icons/${escapeHtml(option.icon)}.svg" alt="" /></span><span class="layer-option-copy"><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small></span><span class="layer-nearby">${escapeHtml(countLabel)}</span></label>`;
}

function syncLegacyPoiTags() {
  const available = availablePoiTags((state.cityPois[state.activeCity] || []).filter(isVisiblePoi)).map(([id]) => id);
  state.poiTags = new Set(available.filter((id) => {
    if (id === 'event') return state.layerLights.news && state.layerFilters.public[id] !== false;
    if (recreationTag(id)) return state.layerLights.recreation && state.layerFilters.public[id] !== false;
    if (LIGHT_CHIPS.cuisine.some((chip) => chip.tags.includes(id))) return state.layerLights.cuisine && state.layerFilters.public[id] !== false;
    return state.layerFilters.public[id] !== false;
  }));
  if (!state.poiTags.size) state.poiTags.add('__none__');
}

async function persistLayerState() {
  const updatedAt = new Date().toISOString();
  await Promise.all([
    db.put('layer_settings', { id: 'current-filters', version: 2, public: { ...state.layerFilters.public }, personal: { ...state.layerFilters.personal }, lights: { ...state.layerLights }, updatedAt }),
    db.put('layer_settings', { id: 'layer-ui-state', version: 1, expanded: { ...state.layerUiState.expanded }, updatedAt })
  ]);
}

function applyLayerChanges({ rerenderFilters = true } = {}) {
  syncLegacyPoiTags();
  renderCityPois(); renderPersonalPlacesOnMap(); renderNewsMarkers(); renderRouteLights(); updateLayerBadge();
  if (rerenderFilters) renderLayerFilters();
  renderMapLights();
  void persistLayerState();
}

function updateLayerStatus() {
  const status = el('poiFilterStatus');
  if (!status) return;
  const groups = buildLayerGroups();
  const total = groups.flatMap((group) => group.options).length;
  const enabled = groups.flatMap((group) => group.options).filter((option) => state.layerFilters[option.kind][option.id] !== false).length;
  status.textContent = `${enabled} of ${total} layers shown. Counts follow the current map view.`;
  updateLayerBadge();
}

function updateLayerBadge() {
  const badge = el('filtersBadge'); if (!badge) return;
  const disabled = buildLayerGroups().flatMap((group) => group.options).filter((option) => state.layerFilters[option.kind][option.id] === false).length;
  badge.textContent = disabled ? String(disabled) : '';
  badge.classList.toggle('hidden', !disabled);
}

async function loadCivicAvailability() {
  const file = CITIES[state.activeCity]?.civicFile;
  if (!file) return { news: false, volunteer: false, capability: 'none', notices: [] };
  try {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Civic pack returned ${response.status}`);
    const payload = await response.json();
    const data = payload?.artifacts || payload || {};
    const current = (item) => !item?.expiresAt || (Number.isFinite(Date.parse(item.expiresAt)) && Date.now() < Date.parse(item.expiresAt));
    const notice = (item, kind) => {
      const venueText = `${item?.locationLabel || ''} ${item?.venueAddress || ''}`;
      if (!item?.title || !/^https:\/\//i.test(item.officialUrl || '') || !current(item) || /\bvirtual\b|\bonline\b|\bteams\b|\bzoom\b/i.test(venueText)) return null;
      if (kind !== 'Meeting' || !/\b(meeting|forum|hearing|town hall|work session)\b/i.test(item.title)) return null;
      return { ...item, kind, artifact_type: 'temporal_event', location: locateNotice(item) };
    };
    const notices = [
      ...(data.meetings?.items || []).map((item) => notice(item, 'Meeting'))
    ].filter(Boolean);
    const volunteers = data.volunteer?.items || data.volunteer || [];
    notices.sort((a, b) => String(a.startsAt || a.date || '').localeCompare(String(b.startsAt || b.date || '')) || a.title.localeCompare(b.title));
    const declared = payload?.capabilities?.news;
    const capability = ['furnished', 'empty-by-design', 'stale', 'none'].includes(declared) ? declared : (notices.length ? 'furnished' : 'empty-by-design');
    return { news: notices.length > 0, volunteer: volunteers.some((item) => item?.officialUrl && current(item)), capability, notices };
  } catch {
    return { ...civicAvailability, capability: civicAvailability.notices?.length ? 'stale' : 'none' };
  }
}

function locateNotice(item) {
  const lat = Number(item.latitude ?? item.lat ?? item.location?.lat);
  const lng = Number(item.longitude ?? item.lng ?? item.location?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const venue = `${item.locationLabel || ''} ${item.venueAddress || ''}`.toLocaleLowerCase();
  if (!venue.trim()) return null;
  const knownVenue = CIVIC_VENUES.find(({ match }) => match.test(venue));
  if (knownVenue) return { lat: knownVenue.lat, lng: knownVenue.lng };
  const candidates = (state.cityPois[state.activeCity] || []).filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng));
  const scored = candidates.map((poi) => {
    const words = String(poi.name || '').toLocaleLowerCase().split(/\W+/).filter((word) => word.length > 3);
    return { poi, score: words.filter((word) => venue.includes(word)).length };
  }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score);
  return scored[0] && scored[0].score >= 2 ? { lat: scored[0].poi.lat, lng: scored[0].poi.lng } : null;
}

function renderNewsMarkers() {
  if (!state.map) return;
  if (!state.newsLayer) state.newsLayer = L.layerGroup().addTo(state.map);
  state.newsLayer.clearLayers();
  if (!state.layerLights.news) return;
  const located = civicAvailability.notices.filter((notice) => notice.location);
  const venues = new Map();
  located.forEach((notice) => {
    const key = `${notice.location.lat.toFixed(5)}:${notice.location.lng.toFixed(5)}`;
    if (!venues.has(key)) venues.set(key, { location: notice.location, notices: [] });
    venues.get(key).notices.push(notice);
  });
  venues.forEach(({ location, notices }) => {
    const icon = L.divIcon({ className: '', html: '<div class="poi-marker event"><img data-inline-svg data-icon-fallback="·" src="./icons/star.svg" alt="" /></div>', iconSize: [27, 27], iconAnchor: [13, 13] });
    const links = notices.map((notice) => `<a href="${escapeHtml(notice.officialUrl)}" target="_blank" rel="noreferrer">${escapeHtml(notice.title)} ↗</a>`).join('<br>');
    L.marker([location.lat, location.lng], { icon, title: notices[0].locationLabel || notices[0].title }).bindPopup(links).addTo(state.newsLayer);
  });
  void hydrateInlineIcons(state.map.getContainer());
}

function packPublicMarkers(light, chipId = null) {
  return state.publicMarkers.filter((marker) => marker.pack_id === state.activeCity && marker.status !== 'withdrawn' && marker.light === light && (chipId == null || marker.chip_id === chipId));
}

function availableMapChips(kind) {
  const pois = (state.cityPois[state.activeCity] || []).filter(isVisiblePoi);
  const availableTags = new Set(pois.flatMap(poiTags));
  return LIGHT_CHIPS[kind].map((chip) => {
    let tags = chip.prefix ? [...availableTags].filter((id) => id.startsWith(chip.prefix)) : chip.tags;
    if (!tags.length && chip.prefix) tags = [chip.prefix];
    let available = tags.some((id) => availableTags.has(id));
    if (chip.id === 'routes') available = routesForCity(state.activeCity).length > 0;
    if (chip.id === 'volunteer') available = civicAvailability.volunteer;
    if (packPublicMarkers(kind, chip.id).length) available = true;
    return { ...chip, tags, available };
  }).filter((chip) => chip.available);
}

function routesInViewport() {
  const packaged = routesForCity(state.activeCity).filter((route) => routeInViewport(route.coordinates));
  const saved = (state.walks || []).filter((walk) => routeInViewport((walk.points || []).map((point) => [point.lat, point.lng])));
  return [...packaged.map((route) => ({ ...route, saved: false })), ...saved.map((walk) => ({ ...walk, coordinates: (walk.points || []).map((point) => [point.lat, point.lng]), saved: true }))];
}

function routeInViewport(coordinates = []) {
  if (!coordinates.length || !state.map) return coordinates.length > 0;
  try { return state.map.getBounds().intersects(L.latLngBounds(coordinates)); } catch { return false; }
}

function lightModel() {
  const recreation = availableMapChips('recreation');
  const cuisine = availableMapChips('cuisine');
  const newsEntries = [...civicAvailability.notices, ...packPublicMarkers('news')];
  const personalPins = curatedPersonalPlaces().filter((place) => !place.packId || place.packId === state.activeCity);
  const personal = state.personalPlaceCategories.map((category) => ({ id: category.id, label: category.name, tags: [], kind: 'personal' }));
  return [
    { id: 'news', label: 'NEWS', available: newsAvailable(), chips: [], entries: newsEntries, hasChevron: newsEntries.length > 0 },
    { id: 'recreation', label: 'RECREATION', available: recreation.length > 0, chips: recreation },
    { id: 'cuisine', label: 'CUISINE', available: cuisine.length > 0, chips: cuisine },
    { id: 'personal', label: 'MY PLACES', available: personalPins.length > 0 || packPublicMarkers('personal').length > 0, chips: personal, hasChevron: personal.length > 0 }
  ].filter((light) => light.available);
}

function newsAvailable() {
  const userNews = packPublicMarkers('news').length > 0;
  if (['empty-by-design', 'none'].includes(civicAvailability.capability)) return userNews;
  return userNews || civicAvailability.news || (civicAvailability.capability === 'stale' && civicAvailability.notices.length > 0);
}

function chipSelected(lightId, chip) {
  if (chip.kind === 'personal') return state.layerFilters.personal[chip.id] !== false;
  return chip.tags.some((id) => state.layerFilters.public[id] !== false);
}

function newsEntry(entry) {
  if (entry.light === 'news') return `<button type="button" class="map-news-entry map-news-entry--post" data-news-marker="${escapeHtml(entry.id)}">${entry.name ? `<strong>${escapeHtml(entry.name)}</strong>` : ''}<small>@${escapeHtml(entry.creator_username)}</small></button>`;
  const source = entry.source?.name || 'Official source';
  return `<a class="map-news-entry map-news-entry--pack" href="${escapeHtml(entry.officialUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml([entry.kind, entry.date, source].filter(Boolean).join(' · '))}</small></a>`;
}

function expandedLightContent(light, expanded) {
  if (expanded !== light.id) return '';
  if (light.id === 'news') return `<div class="map-light-chips map-news-list" data-light-chips="news">${light.entries.map(newsEntry).join('')}</div>`;
  if (!light.chips.length) return '';
  return `<div class="map-light-chips" data-light-chips="${light.id}">${light.chips.map((chip) => {
    const selected = chipSelected(light.id, chip);
    return `<button type="button" class="map-light-chip ${selected ? 'on' : ''}" data-light-chip="${light.id}:${chip.id}" aria-pressed="${selected}">${escapeHtml(chip.label)}</button>`;
  }).join('')}</div>`;
}

export function renderMapLights() {
  const root = el('mapLights');
  if (!root) return;
  const expanded = state.layerUiState.lightExpanded || '';
  root.innerHTML = lightModel().map((light) => {
    const on = state.layerLights[light.id] === true;
    const hasChevron = light.hasChevron ?? light.chips.length > 0;
    return `<div class="map-light-wrap" data-map-light="${light.id}">${expandedLightContent(light, expanded)}<div class="map-light-row"><button type="button" class="map-light ${on ? 'on' : 'off'}" data-light="${light.id}" aria-pressed="${on}">${escapeHtml(light.label)}</button>${hasChevron ? `<button type="button" class="map-light-chevron" data-light-expand="${light.id}" aria-label="Show ${escapeHtml(light.label.toLowerCase())} choices" aria-expanded="${expanded === light.id}"><span aria-hidden="true">▲</span></button>` : ''}</div></div>`;
  }).join('');
}

function setChip(chip, enabled) {
  if (chip.kind === 'personal') state.layerFilters.personal[chip.id] = enabled;
  else chip.tags.forEach((id) => { state.layerFilters.public[id] = enabled; });
}

function toggleLight(id) {
  const model = lightModel().find((light) => light.id === id);
  if (!model) return;
  const enabled = !state.layerLights[id];
  state.layerLights[id] = enabled;
  if (id === 'news') state.layerFilters.public.event = enabled;
  model.chips.forEach((chip) => setChip(chip, enabled));
  applyLayerChanges();
}

function toggleChip(lightId, chipId) {
  const chip = lightModel().find((light) => light.id === lightId)?.chips.find((candidate) => candidate.id === chipId);
  if (!chip) return;
  const enabled = !chipSelected(lightId, chip);
  setChip(chip, enabled);
  state.layerLights[lightId] = true;
  applyLayerChanges();
}

function renderRouteLights() {
  if (!state.map) return;
  if (!state.routeLightLayer) state.routeLightLayer = L.layerGroup().addTo(state.map);
  state.routeLightLayer.clearLayers();
  if (!state.layerLights.recreation || state.layerFilters.public.__routes === false) return;
  routesInViewport().forEach((route) => {
    const line = L.polyline(route.coordinates, { color: route.saved ? '#8b5e3c' : '#173c35', weight: route.saved ? 4 : 5, opacity: .82, dashArray: route.saved ? null : '9 6' });
    line.bindTooltip(escapeHtml(route.title || route.name || 'Saved walk'));
    line.addTo(state.routeLightLayer);
  });
}

export function createWalkFilterPayload({ name = 'My walk filters', description = '', author = '', now = new Date().toISOString() } = {}) {
  const filters = {};
  for (const group of buildAllLayerGroups()) {
    filters[group.id] = Object.fromEntries(group.options.map((option) => [option.id, { enabled: state.layerFilters[option.kind][option.id] !== false, icon: option.icon, color: option.color, label: option.label }]));
  }
  return {
    name: String(name).trim() || 'My walk filters', version: '1.0', created: now,
    description: String(description).trim(), author: String(author).trim(), filters,
    personal_place_categories: state.personalPlaceCategories.map(({ updatedAt, ...category }) => category),
    personal_places_data: curatedPersonalPlaces().map(({ photos, private: _private, state: _state, updatedAt, ...place }) => ({ ...place, photos: [] })),
    export_format: 'walk-wildlife-filters-v1'
  };
}

export function parseFilterImport(input) {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  if (!payload || !['walk-wildlife-filters-v1', 'walk-wildlife-personal-places-v1'].includes(payload.export_format)) throw new Error('Choose a .walkfilter, .walkplaces, or compatible JSON export.');
  if (payload.filters != null && (typeof payload.filters !== 'object' || Array.isArray(payload.filters))) throw new Error('The filter section is not valid.');
  if (payload.personal_places_data != null && !Array.isArray(payload.personal_places_data)) throw new Error('The personal places section is not valid.');
  if (payload.personal_place_categories != null && !Array.isArray(payload.personal_place_categories)) throw new Error('The personal categories section is not valid.');
  return payload;
}

export function flattenImportedFilters(filters = {}) {
  const result = { public: {}, personal: {} };
  for (const [groupId, entries] of Object.entries(filters || {})) {
    if (!entries || typeof entries !== 'object') continue;
    const kind = groupId === 'personal_places' ? 'personal' : 'public';
    for (const [id, value] of Object.entries(entries)) result[kind][id] = typeof value === 'object' ? value.enabled !== false : value !== false;
  }
  return result;
}

function downloadFilterSet() {
  const payload = createWalkFilterPayload({ name: el('filterExportName').value, description: el('filterExportDescription').value, author: el('filterExportAuthor').value });
  const safeName = payload.name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'walk-filters';
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${safeName}.walkfilter`; link.click(); URL.revokeObjectURL(url);
  closeSheets(); toast('Filter set exported. Personal place photos stayed on this device.');
}

async function previewImportFile(file) {
  if (!file) return;
  try { pendingImport = parseFilterImport(await file.text()); showImportPreview(file.name); }
  catch (error) { pendingImport = null; toast(error.message || 'That filter file could not be read.'); }
}

function previewPastedImport() {
  try { pendingImport = parseFilterImport(el('filterImportJson').value); showImportPreview('Pasted JSON'); }
  catch (error) { pendingImport = null; toast(error.message || 'That JSON could not be read.'); }
}

function showImportPreview(filename) {
  const categories = pendingImport.personal_place_categories || inferredCategories(pendingImport);
  const places = pendingImport.personal_places_data || [];
  const filterCount = Object.values(pendingImport.filters || {}).reduce((count, group) => count + Object.keys(group || {}).length, 0);
  const duplicates = places.filter((candidate) => curatedPersonalPlaces().some((place) => {
    try { return Math.abs(place.location.lat - (candidate.location?.lat ?? candidate.lat)) < 0.0002 && Math.abs(place.location.lng - (candidate.location?.lng ?? candidate.lng)) < 0.0002; } catch { return false; }
  })).length;
  el('filterImportPreview').classList.remove('hidden');
  el('filterImportFilename').textContent = filename;
  el('filterImportMeta').textContent = [pendingImport.author && `By ${pendingImport.author}`, pendingImport.created && new Date(pendingImport.created).toLocaleDateString()].filter(Boolean).join(' · ') || 'Local filter set';
  el('filterImportDescription').textContent = pendingImport.description || 'No description provided.';
  el('filterImportIncludes').textContent = `${filterCount} filter${filterCount === 1 ? '' : 's'} · ${categories.length} personal collection${categories.length === 1 ? '' : 's'} · ${places.length} custom location${places.length === 1 ? '' : 's'}`;
  el('filterDuplicateRow').classList.toggle('hidden', !duplicates);
  el('filterDuplicateCount').textContent = `${duplicates} possible duplicate${duplicates === 1 ? '' : 's'} found`;
  el('confirmFilterImportButton').disabled = false;
}

function inferredCategories(payload) {
  const categoryIds = new Set([
    ...Object.keys(payload.filters?.personal_places || {}),
    ...(payload.personal_places_data || []).map((place) => place.categoryId || place.category_id || place.category).filter(Boolean)
  ]);
  return [...categoryIds].map((id) => ({ id, name: titleCase(id), icon: payload.filters?.personal_places?.[id]?.icon || 'map-pin', color: payload.filters?.personal_places?.[id]?.color || '#E8740F' }));
}

async function applyPendingImport() {
  if (!pendingImport) return;
  const applyFilters = el('filterImportApplyFilters').checked;
  const importPlaces = el('filterImportPersonalPlaces').checked;
  const replace = el('filterImportReplace').checked;
  if (applyFilters && pendingImport.filters) {
    const imported = flattenImportedFilters(pendingImport.filters);
    if (replace) {
      Object.keys(state.layerFilters.public).forEach((id) => { state.layerFilters.public[id] = false; });
      Object.keys(state.layerFilters.personal).forEach((id) => { state.layerFilters.personal[id] = false; });
    }
    Object.assign(state.layerFilters.public, imported.public);
    Object.assign(state.layerFilters.personal, imported.personal);
  }
  let result = { added: 0, merged: 0, skipped: 0 };
  if (importPlaces) result = await upsertImportedPersonalData(inferredCategories(pendingImport).concat(pendingImport.personal_place_categories || []), pendingImport.personal_places_data || [], el('filterDuplicateStrategy').value);
  applyLayerChanges();
  closeSheets();
  toast(`Filter set imported${importPlaces ? ` · ${result.added} places added, ${result.merged} merged, ${result.skipped} skipped` : ''}.`);
  pendingImport = null;
}

function openImportSheet() {
  pendingImport = null;
  el('filterImportFile').value = ''; el('filterImportJson').value = '';
  el('filterImportPreview').classList.add('hidden'); el('confirmFilterImportButton').disabled = true;
  openSheet('filterImportSheet');
}

function bindLayerControls() {
  el('mapLights')?.addEventListener('click', (event) => {
    const newsMarker = event.target.closest('[data-news-marker]');
    if (newsMarker) { window.dispatchEvent(new CustomEvent('public-marker-focus-requested', { detail: { markerId: newsMarker.dataset.newsMarker } })); return; }
    const light = event.target.closest('[data-light]');
    if (light) { toggleLight(light.dataset.light); return; }
    const expand = event.target.closest('[data-light-expand]');
    if (expand) {
      state.layerUiState.lightExpanded = state.layerUiState.lightExpanded === expand.dataset.lightExpand ? '' : expand.dataset.lightExpand;
      renderMapLights(); void persistLayerState(); return;
    }
    const chip = event.target.closest('[data-light-chip]');
    if (chip) { const [lightId, chipId] = chip.dataset.lightChip.split(':'); toggleChip(lightId, chipId); }
  });
  el('mapLights')?.addEventListener('dblclick', (event) => event.stopPropagation());
  el('poiTagFilters')?.addEventListener('change', (event) => {
    const filter = event.target.closest('[data-layer-filter]');
    if (filter) {
      const [kind, ...idParts] = filter.dataset.layerFilter.split(':');
      state.layerFilters[kind][idParts.join(':')] = filter.checked;
      applyLayerChanges(); return;
    }
    const all = event.target.closest('[data-layer-toggle-all]');
    if (all) {
      const group = buildLayerGroups().find((candidate) => candidate.id === all.dataset.layerToggleAll);
      group?.options.forEach((option) => { state.layerFilters[option.kind][option.id] = all.checked; });
      applyLayerChanges();
    }
  });
  el('poiTagFilters')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-layer-collapse]'); if (!button) return;
    const id = button.dataset.layerCollapse; state.layerUiState.expanded[id] = !(state.layerUiState.expanded[id] !== false);
    renderLayerFilters(); void persistLayerState();
  });
  el('layerFilterSearch')?.addEventListener('input', (event) => { searchQuery = event.target.value; renderLayerFilters(); });
  el('exportCurrentFiltersButton')?.addEventListener('click', () => { closeSheets(); openSheet('filterExportSheet'); });
  el('importFilterSetButton')?.addEventListener('click', openImportSheet);
  el('filterExportForm')?.addEventListener('submit', (event) => { event.preventDefault(); downloadFilterSet(); });
  el('filterImportFile')?.addEventListener('change', (event) => void previewImportFile(event.target.files[0]));
  el('previewFilterImportButton')?.addEventListener('click', previewPastedImport);
  el('confirmFilterImportButton')?.addEventListener('click', () => void applyPendingImport());
  window.addEventListener('layers-sheet-opened', () => { searchQuery = ''; el('layerFilterSearch').value = ''; renderLayerFilters(); });
  window.addEventListener('filter-import-requested', openImportSheet);
  window.addEventListener('personal-places-changed', () => { ensureLayerDefaults(); renderLayerFilters(); applyLayerChanges({ rerenderFilters: false }); });
  window.addEventListener('public-markers-changed', () => { ensureLayerDefaults(); applyLayerChanges({ rerenderFilters: false }); });
  window.addEventListener('layer-state-dirty', () => applyLayerChanges());
  window.addEventListener('map-viewport-changed', () => { renderMapLights(); renderRouteLights(); });
  window.addEventListener('city-layer-data-changed', async () => {
    civicAvailability = await loadCivicAvailability();
    await refreshPublicMarkers(state.activeCity);
    ensureLayerDefaults();
    state.layerLights.news = newsAvailable();
    state.layerLights.recreation = availableMapChips('recreation').length > 0;
    state.layerLights.cuisine = false;
    availableMapChips('recreation').forEach((chip) => setChip(chip, true));
    availableMapChips('cuisine').forEach((chip) => setChip(chip, false));
    applyLayerChanges();
  });
}
