import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES, HISTORY_SUBTYPES, POI_TAGS, POI_TAG_PRIORITY } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { distanceMeters } from './geo.js';
import { openSheet } from './ui.js';
import db from './storage.js';
import { isLocallyClosedPoi } from './spatial-closure-reporting.js';
import { seasonalComparison, standoutObservation } from './revisit.js';
import { markerPinHtml, markerVisual } from './poi-icons.js';

const POI_FILTER_GROUPS = [
  { id: 'outdoors', label: 'Nature & outdoors', icon: '🌿', tags: ['park', 'trail', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad', 'rest'] },
  { id: 'history-culture', label: 'History, art & culture', icon: '🏛', tags: ['history', 'history_landmark', 'history_monument', 'history_museum', 'history_cemetery', 'history_marker', 'art', 'public_art'] },
  { id: 'community', label: 'Community & essentials', icon: '●', tags: ['community', 'facility', 'library', 'recreation_center', 'pantry', 'wifi', 'restrooms'] },
  { id: 'activities', label: 'Sports & activities', icon: '◈', tags: ['basketball', 'tennis', 'disc_golf', 'skate_park'] },
  { id: 'food', label: 'Food & drink', icon: '☕', tags: ['coffee', 'coffee_shop', 'cafe', 'tea'] },
  { id: 'other', label: 'More map layers', icon: '◇', tags: ['event', 'osm'] }
];
const FOOD_FILTER_TAGS = new Set(['açaí', 'american', 'armenian', 'asian', 'bagel', 'bakery', 'beer', 'bistro', 'brazilian', 'breakfast', 'bubble_tea', 'burger', 'cake', 'caribbean', 'chinese', 'cookie', 'cuban', 'cupcake', 'deli', 'dessert', 'diner', 'donut', 'eclair', 'empanada', 'ethiopian', 'european', 'filipino', 'french', 'fusion', 'gelato', 'german', 'ice_cream', 'indian', 'italian', 'jamaican', 'japanese', 'juice', 'korean', 'lebanese', 'macaron', 'mediterranean', 'mexican', 'middle_eastern', 'nordic', 'pastry', 'peruvian', 'pie', 'pizza', 'pretzel', 'regional', 'salad', 'salvadoran', 'sandwich', 'shawarma', 'smoothie', 'swiss', 'tart', 'toast', 'vietnamese', 'wine']);
export const isFoodFilterTag = (id) => FOOD_FILTER_TAGS.has(String(id).toLocaleLowerCase());

export function renderPoiTagFilters() {
  const pois = state.cityPois[state.activeCity] || [];
  const availableTags = availablePoiTags(pois.filter(isVisiblePoi));
  const filters = el('poiTagFilters');
  const status = el('poiFilterStatus');
  if (!availableTags.length) {
    filters.innerHTML = '';
    status.textContent = 'No imported POI categories are available for this region yet.';
    updateFiltersBadge();
    return;
  }
  const available = new Map(availableTags);
  const knownGroupedTags = new Set(POI_FILTER_GROUPS.flatMap((group) => group.tags));
  const groups = POI_FILTER_GROUPS.map((group) => ({ ...group, options: group.tags.filter((id) => available.has(id)).map((id) => [id, available.get(id)]) }));
  const extras = availableTags.filter(([id]) => !knownGroupedTags.has(id) && !isFoodFilterTag(id));
  groups.find((group) => group.id === 'food').options.push(...availableTags.filter(([id]) => isFoodFilterTag(id)));
  if (extras.length) groups.at(-1).options.push(...extras);
  const allSelected = !state.poiTags.size;
  filters.innerHTML = groups.filter((group) => group.options.length).map((group, index) => {
    const selectedCount = group.options.filter(([id]) => allSelected || state.poiTags.has(id)).length;
    return `<details class="poi-filter-group" ${index === 0 ? 'open' : ''}><summary><span>${group.icon} ${group.label}</span><small>${selectedCount}/${group.options.length}</small></summary><div class="poi-filter-options">${group.options.map(([id, label]) => { const selected = allSelected || state.poiTags.has(id); return `<button type="button" class="poi-chip ${selected ? 'active' : ''}" aria-pressed="${selected}" data-poi-tag="${id}">${label}</button>`; }).join('')}</div></details>`;
  }).join('');
  const visible = pois.filter(isVisiblePoi).filter(poiMatchesFilters);
  status.textContent = state.poiTags.has('__none__') ? 'No place categories selected.' : visible.length ? `${visible.length} imported place${visible.length === 1 ? '' : 's'} match${state.poiTags.size ? ' these filters' : ''}.` : 'No imported places match these filters.';
  updateFiltersBadge();
}
export function togglePoiTag(id) {
  const availableIds = availablePoiTags((state.cityPois[state.activeCity] || []).filter(isVisiblePoi)).map(([tagId]) => tagId);
  if (!state.poiTags.size) state.poiTags = new Set(availableIds);
  if (state.poiTags.has('__none__')) state.poiTags.clear();
  if (state.poiTags.has(id)) state.poiTags.delete(id); else state.poiTags.add(id);
  if (!state.poiTags.size) state.poiTags.add('__none__');
}
export function setAllPoiTags(selected) { state.poiTags = selected ? new Set() : new Set(['__none__']); }
export function updateFiltersBadge() {
  const badge = el('filtersBadge');
  if (!badge) return;
  const publicIds = availablePoiTags((state.cityPois[state.activeCity] || []).filter(isVisiblePoi)).map(([id]) => id);
  const disabled = publicIds.filter((id) => state.layerFilters?.public?.[id] === false).length
    + (state.personalPlaceCategories || []).filter((category) => state.layerFilters?.personal?.[category.id] === false).length;
  badge.textContent = disabled ? String(disabled) : '';
  badge.classList.toggle('hidden', !disabled);
}
export function poiMatchesFilters(poi) {
  return poiObeysMapLights(poi) && poiMatchesSelectedTags(poi, state.poiTags);
}

const CAFE_TAGS = ['coffee', 'coffee_shop', 'cafe'];
const MARKET_TAGS = ['market', 'farmers_market', 'grocery', 'supermarket', 'convenience'];
const RESTAURANT_TAGS = ['restaurant', 'fast_food'];
const NATURE_TAGS = ['park', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad', 'rest', 'restrooms', 'drinking_water', 'water_fountain', 'shelter'];
const NATURE_TREE_TAGS = new Set(['park', 'nature', 'garden', 'community_garden', 'playground', 'dog_park', 'shelter']);
const NATURE_WATER_TAGS = new Set(['drinking_water', 'water_fountain', 'water', 'water_access']);
const NATURE_WILDLIFE_TAGS = new Set(['wildlife']);
const NATURE_REST_TAGS = new Set(['rest', 'restrooms']);
export const NATURE_COUNTY_CAP = 120;
export const WALK_ZOOM = 14;

function anyEnabled(tags) { return tags.some((tag) => state.layerFilters?.public?.[tag] !== false); }

export function poiObeysMapLights(poi) {
  const tags = poiTags(poi);
  const matches = [];
  const nature = tags.filter((tag) => NATURE_TAGS.includes(tag));
  if (nature.length) matches.push(state.layerLights?.recreation && anyEnabled(nature));
  const history = tags.filter((tag) => tag === 'history' || tag.startsWith('history_'));
  if (history.length) matches.push(state.layerLights?.recreation && anyEnabled(history));
  if (tags.includes('trail')) matches.push(state.layerLights?.recreation && state.layerFilters?.public?.trail !== false);
  const foodFamily = tags.some((tag) => CAFE_TAGS.includes(tag)) ? CAFE_TAGS
    : tags.some((tag) => MARKET_TAGS.includes(tag)) ? MARKET_TAGS
      : tags.some((tag) => RESTAURANT_TAGS.includes(tag)) ? RESTAURANT_TAGS : null;
  if (foodFamily) matches.push(state.layerLights?.cuisine && anyEnabled(foodFamily));
  if (tags.includes('event')) matches.push(state.layerLights?.news && state.layerFilters?.public?.event !== false);
  return matches.length ? matches.some(Boolean) : true;
}
// Filter choices come from the imported POI set, never the currently visible
// result set. That keeps a selected category reversible even when it produces
// zero markers, and makes an intentionally empty regional release stable.
export function availablePoiTags(pois = []) {
  const known = new Map(POI_TAGS);
  const present = new Set((pois || []).flatMap((poi) => poiTags(poi)));
  if ((pois || []).some(isOsmPoi)) present.add('osm');
  const ordered = POI_TAGS.filter(([id]) => present.has(id));
  const extras = [...present]
    .filter((id) => !known.has(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => [id, id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())]);
  return [...ordered, ...extras];
}

export function isOsmPoi(poi) {
  if (poi?.fromOsm || poi?.sourceType === 'osm-quiet-fallback' || String(poi?.id || '').startsWith('osm:')) return true;
  const sources = Array.isArray(poi?.source) ? poi.source : [poi?.source];
  return sources.some((source) => /openstreetmap|overpass/i.test(typeof source === 'string' ? source : [source?.name, source?.url].filter(Boolean).join(' ')));
}

export function geofenceCategoriesForCity(cityId = state.activeCity) {
  const available = new Set((state.cityPois[cityId] || [])
    .filter(isWalkablePoi)
    .filter(isVisiblePoi)
    .filter((poi) => !isOsmPoi(poi))
    .flatMap((poi) => normalizePoiTags(poi)));
  const known = new Map(POI_TAGS);
  const ordered = POI_TAGS.filter(([id]) => available.has(id) && !id.startsWith('history_'));
  const extras = [...available].filter((id) => !known.has(id) && !id.startsWith('history_')).sort().map((id) => [id, id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())]);
  return [...ordered, ...extras];
}
export function poiMatchesSelectedTags(poi, selectedTags = new Set()) {
  if (selectedTags.has('__none__')) return false;
  if (!selectedTags.size) return true;
  const tags = poiTags(poi);
  return [...selectedTags].some((tag) => tag === 'osm' ? isOsmPoi(poi) : tags.includes(tag));
}
export function renderCityPois() {
  if (!state.poiLayer) return;
  state.poiLayer.clearLayers(); state.trailLayer.clearLayers();
  const pois = state.cityPois[state.activeCity] || [];
  const visiblePois = pois
    .filter((poi) => poi.category !== 'journey')
    .filter((poi) => !hasPackTrailGeometry(poi))
    .filter(isVisiblePoi)
    .filter(poiMatchesFilters)
    .filter(withinRenderBounds);
  const markers = paintOrder(visiblePois)
    .map((poi) => {
      const tags = poiTags(poi);
      const visual = markerVisual({ poi, tags });
      const icon = L.divIcon({ className: '', html: markerPinHtml(visual), iconSize: [27, 27], iconAnchor: [13, 13] });
      const marker = L.marker([poi.lat, poi.lng], { icon, title: displayPoiName(poi), interactive: !state.planningMode, place: poi }).bindPopup(`<strong>${escapeHtml(displayPoiName(poi))}</strong><br><small>${escapeHtml(packAttribution(poi))}</small>`);
      return marker;
    });
  if (state.poiLayer.addLayers) state.poiLayer.addLayers(markers); else markers.forEach((marker) => marker.addTo(state.poiLayer));
  const segments = state.trailSegments[state.activeCity] || [];
  if (state.layerLights?.recreation && state.layerFilters?.public?.trail !== false) {
    segments.forEach((segment) => segment.coordinates.forEach((coordinates) => L.polyline(coordinates.map(([lng, lat]) => [lat, lng]), { color: '#2d7259', weight: 5, opacity: .82 }).bindTooltip(segment.name || 'Named trail').addTo(state.trailLayer)));
  }
  state.historyRadiusLayer?.clearLayers();
}

function paintGroup(poi) {
  const tags = poiTags(poi);
  if (tags.some((tag) => tag === 'history' || tag.startsWith('history_'))) return 'historic';
  if (tags.includes('trail')) return 'trails';
  if (tags.some((tag) => [...CAFE_TAGS, ...MARKET_TAGS, ...RESTAURANT_TAGS].includes(tag))) return 'cuisine';
  if (tags.some((tag) => NATURE_TAGS.includes(tag))) return 'nature';
  if (tags.includes('event')) return 'news';
  return 'other';
}

function naturePriority(poi) {
  const tags = poiTags(poi);
  if (tags.some((tag) => NATURE_TREE_TAGS.has(tag))) return 0;
  if (tags.some((tag) => NATURE_WATER_TAGS.has(tag))) return 1;
  if (tags.some((tag) => NATURE_WILDLIFE_TAGS.has(tag))) return 2;
  if (tags.some((tag) => NATURE_REST_TAGS.has(tag))) return 3;
  return 4;
}

function paintOrder(pois) {
  const indexed = pois.map((poi, index) => ({ poi, index, group: paintGroup(poi) }));
  const nature = indexed.filter((entry) => entry.group === 'nature')
    .sort((left, right) => naturePriority(left.poi) - naturePriority(right.poi) || left.index - right.index);
  const zoom = Number(state.map?.getZoom?.());
  const countyNature = !Number.isFinite(zoom) || zoom < WALK_ZOOM;
  const allowedNature = countyNature ? nature.slice(0, NATURE_COUNTY_CAP) : nature;
  const allowed = new Set(allowedNature);
  return indexed.filter((entry) => entry.group !== 'nature' || allowed.has(entry))
    .sort((left, right) => {
      if (left.group === 'nature' && right.group === 'nature') return naturePriority(left.poi) - naturePriority(right.poi) || left.index - right.index;
      return left.index - right.index;
    }).map((entry) => entry.poi);
}

function packAttribution(poi) {
  const sources = Array.isArray(poi?.source) ? poi.source : [poi?.source];
  const named = sources.find((source) => typeof source === 'object' && source?.name)?.name;
  return named || poi?.provenance?.dataset || `${CITIES[state.activeCity]?.name || 'Installed'} pack`;
}

function hasPackTrailGeometry(poi) {
  if (!poiTags(poi).includes('trail')) return false;
  if (['LineString', 'MultiLineString'].includes(poi.geometry?.type)) return true;
  return (state.trailSegments[state.activeCity] || []).some((segment) => String(segment.id) === String(poi.id));
}
export function renderCityExplorer() {
  updateFiltersBadge();
}







export function normalizePoiTags(poi) {
  const tags = [...(poi.tags || [])];
  if (poi.category && !tags.includes(poi.category)) tags.push(poi.category);
  if (poi.type && !tags.includes(poi.type)) tags.push(poi.type);
  if (poi.amenities) poi.amenities.forEach((amenity) => { if (!tags.includes(amenity)) tags.push(amenity); });
  // Source data sometimes marks a site historic only in `subcategory` (e.g.
  // Norfolk's "HISTORICAL" library subcategory) without a top-level `history`
  // tag. Fold that in rather than dropping it silently.
  if (poi.subcategory && /histor/i.test(poi.subcategory) && !tags.includes('history')) tags.push('history');
  // NYC Parks' "Historical Signs" dataset: every record's own name/source
  // says "— Historical Sign" / "Historical Signs (borough)" — this is the
  // source's own label for what the record IS, not a name-keyword guess like
  // "Memorial"/"Monument" (which stay in the audit script for a human to
  // confirm). Only ~128/2266 had a `history` tag from import; the rest were
  // tagged solely by their physical park/location category.
  if (/historical sign/i.test(`${poi.name || ''} ${poi.source || ''}`) && !tags.includes('history')) tags.push('history');
  return tags;
}
export function inferHistorySubtype(poi) {
  if (poi.historySubtype && HISTORY_SUBTYPES[poi.historySubtype]) return poi.historySubtype;
  const text = `${poi.subcategory || ''} ${poi.name || ''} ${poi.description || ''}`;
  if (/museum/i.test(text)) return 'museum';
  if (/monument/i.test(text)) return 'monument';
  if (/cemetery/i.test(text)) return 'cemetery';
  if (/librar|building|hall|house|church/i.test(text)) return 'landmark';
  return 'marker';
}
export function poiTags(poi) {
  const tags = normalizePoiTags(poi);
  if (tags.includes('history')) {
    const subtypeTag = `history_${inferHistorySubtype(poi)}`;
    if (!tags.includes(subtypeTag)) tags.push(subtypeTag);
  }
  return tags;
}
export function primaryPoiTag(poi) {
  const tags = poiTags(poi);
  return POI_TAG_PRIORITY.find((tag) => tags.includes(tag)) || tags[0] || 'history';
}
export function migratePoi(poi, cityId) {
  const config = CITIES[cityId];
  return { ...poi, city: cityId, tags: normalizePoiTags(poi), radius: poi.radius || config?.defaultGeofenceRadiusMeters || 50 };
}
export function displayPoiName(poi) {
  if (/^\d+$/.test(String(poi?.name || '')) && /^HeritageTrailPt_/i.test(String(poi?.sourceId || ''))) return `DC Neighborhood Heritage Trail sign ${poi.name}`;
  // USGS monitoring names are sometimes legal-land descriptions such as
  // "03N 02E 10BBCC1". They identify a station but are not useful human
  // place names, so present the record's real purpose instead.
  const isUsgsWater = isWaterMonitoringAnchor(poi);
  if (!isUsgsWater) return poi?.name || 'Unnamed place';
  return `USGS water monitoring location${poi.type ? ` · ${poi.type}` : ''}${poi.agency ? ` · ${poi.agency}` : ''}`;
}

export function displayPoiDescription(poi) { return /^https:\/\/www\.culturaltourismdc\.org\/portal\/dc-neighborhood-heritage-trails\/?$/i.test(String(poi?.description || '')) ? 'DC Neighborhood Heritage Trail sign location, sourced from DC GIS.' : poi?.description; }

export function isVerifiedPoi(poi) { return poi?.review?.validationStatus === 'valid' || poi?.unverified === false || (Array.isArray(poi?.source) ? poi.source : [poi?.source]).some((source) => typeof source === 'object' && source?.url); }
export function isWaterMonitoringAnchor(poi) {
  return poi?.category === 'water' && (poi.monitoringLocationId || (Array.isArray(poi.source) && poi.source.some((source) => /USGS water monitoring/i.test(source?.name || ''))));
}
export function city() { return CITIES[state.activeCity]; }
// A "history site" is any POI actually tagged `history` — NOT any POI that
// happens to have a geofence radius (every POI gets a default radius via
// migratePoi, so that check was matching parks, libraries, etc. too).
// Used for the history map layer/demo only — NOT the profile progress stat,
// see cityDiscoverableSites() below for that.
export function citySites() { return (state.cityPois[state.activeCity] || []).filter((poi) => poiTags(poi).includes('history')); }
// The profile "X/Y sites" stat and the Explorer badge track discovery across
// every enabled geofence category (parks, libraries, art, etc.) — that's what
// checkGeofences() actually awards, not just history sites. Mirrors its
// eligibility check so the denominator always matches what's collectible.
export function cityDiscoverableSites() {
  const pois = state.cityPois[state.activeCity] || [];
  const enabledStars = new Set(state.settings?.geofenceCategories || ['recreation', 'cuisine']);
  return pois.filter((poi) => {
    const tags = poiTags(poi);
    const recreation = tags.some((tag) => ['park', 'trail', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad', 'history', 'rest'].includes(tag) || tag.startsWith('history_'));
    const cuisine = tags.some((tag) => [...CAFE_TAGS, ...MARKET_TAGS, ...RESTAURANT_TAGS].includes(tag));
    return (recreation && enabledStars.has('recreation')) || (cuisine && enabledStars.has('cuisine'));
  });
}
export function withinRenderBounds(poi) {
  if (!state.map) return true;
  try { return state.map.getBounds().pad(0.6).contains([poi.lat, poi.lng]); } catch { return true; }
}
export async function showHistory(site, distance) {
  state.currentSite = site; state.prompted.add(`${state.activeCity}:${site.id}`);
  el('historyTitle').textContent = site.name;
  el('historyDescription').textContent = site.description;
  el('historySource').href = site.source || '#';
  el('historySource').classList.toggle('hidden', !site.source);
  el('historyWarning').classList.toggle('hidden', !site.unverified);
  el('historyDistance').textContent = Number.isFinite(distance) ? `${Math.round(distance)} m from your location` : 'Within your walking radius';

  const memory = await getPlaceMemory(site.id);
  el('historyReturnBanner').classList.toggle('hidden', !memory);
  const details = el('historyVisitDetails');
  if (memory) {
    const observations = await db.all('observations');
    const observation = standoutObservation({ location: { lat: site.lat, lng: site.lng } }, observations);
    const lastVisit = memory.lastVisitDate ? new Date(memory.lastVisitDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'an earlier walk';
    el('historyReturnBanner').innerHTML = `<strong>Welcome back.</strong> Last here ${escapeHtml(lastVisit)}.${observation ? ` You noticed ${escapeHtml(observation.species || observation.title || observation.note || 'something worth keeping')}.` : ''}${memory.futureSelfNote ? `<small>A note you left for yourself: “${escapeHtml(memory.futureSelfNote)}”</small>` : ''}<small>${escapeHtml(seasonalComparison(memory.lastVisitDate) || '')}</small>`;
    const visits = [...(memory.visits || [])].reverse();
    details.classList.toggle('hidden', visits.length < 2);
    el('historyVisitList').innerHTML = visits.map((visit) => `<li><time>${escapeHtml(new Date(visit.visitedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</time>${visit.note ? `<p>${escapeHtml(visit.note)}</p>` : ''}</li>`).join('');
  } else {
    details.classList.add('hidden');
    el('historyVisitList').replaceChildren();
  }
  el('historyNoteInput').value = '';

  openSheet('historySheet');
}
export async function getPlaceMemory(poiId) {
  return (await db.get('poi_metadata', poiId)) || null;
}

export async function savePlaceMemory(poiOrId, note = '') {
  const poiId = typeof poiOrId === 'object' ? poiOrId.id : poiOrId;
  const poi = typeof poiOrId === 'object' ? poiOrId : (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === String(poiId));
  const existing = await getPlaceMemory(poiId);
  const visitedAt = new Date().toISOString();
  const visits = [...(existing?.visits || []), { visitedAt, note: String(note || '').trim() }].slice(-24);
  const record = {
    id: poiId,
    name: poi?.name || existing?.name || 'Remembered place',
    location: Number.isFinite(poi?.lat) && Number.isFinite(poi?.lng) ? { lat: poi.lat, lng: poi.lng } : existing?.location,
    firstVisitDate: existing?.firstVisitDate || visitedAt,
    visitCount: (existing?.visitCount || 0) + 1,
    lastNote: note || existing?.lastNote || '',
    futureSelfNote: note || existing?.futureSelfNote || '',
    lastVisitDate: visitedAt,
    visits
  };
  await db.put('poi_metadata', record);
  return record;
}

export function searchPois(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pois = state.cityPois[state.activeCity] || [];
  return pois.filter(isVisiblePoi).filter((poi) => `${poi.name || ''} ${displayPoiName(poi)}`.toLowerCase().includes(q)).slice(0, 20);
}
export async function searchOsm(query) {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const active = city();
  const viewbox = active ? `&viewbox=${active.center.lng - 0.15},${active.center.lat + 0.15},${active.center.lng + 0.15},${active.center.lat - 0.15}&bounded=1` : '';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=8${viewbox}`, {
      headers: { 'Accept-Language': 'en' }
    });
    if (!res.ok) return [];
    const results = await res.json();
    return results.map((r) => {
      const elementType = r.osm_type || 'search';
      const elementId = String(r.osm_id || r.place_id);
      return { id: `osm:${elementType}:${elementId}`, name: r.display_name.split(',')[0], lat: parseFloat(r.lat), lng: parseFloat(r.lon), fromOsm: true, sourceType: 'osm_nominatim', osmElementType: elementType, osmElementId: elementId, source: [{ name: 'OpenStreetMap', id: 'osm-nominatim-search', elementId, url: /^node|way|relation$/.test(elementType) ? `https://www.openstreetmap.org/${elementType}/${elementId}` : 'https://www.openstreetmap.org/copyright', attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', retrievedAt: new Date().toISOString() }] };
    });
  } catch {
    return [];
  }
}
export function isWalkablePoi(poi) {
  return Number.isFinite(poi?.lat) && Number.isFinite(poi?.lng) && poi.geometry !== 'polygon' && !poi.nonWalkable && !poi.excludeFromWalks && !poi.routeCandidate && !String(poi.id || '').startsWith('nyc-sign-');
}
export function activeSeasonalSignals(poi, now = Date.now()) {
  return (poi.seasonalSignals || []).filter((signal) => Number.isFinite(Date.parse(signal?.expiresAt)) && now < Date.parse(signal.expiresAt));
}
export function isVisiblePoi(poi, now = Date.now()) {
  if (isLocallyClosedPoi(poi, state.activeCity, now)) return false;
  if (poi.review?.validationStatus === 'invalid') return false;
  // Producer route candidates are segment inputs, never visitor-facing POIs
  // or automatically curated / ranked walks.
  if (poi.routeCandidate) return false;
  // A static USGS station is a data anchor, not a walking destination or a
  // current-condition claim. Keep it out of map/search/filter UI until a
  // future verified, expiring water signal can describe why it matters today.
  if (isWaterMonitoringAnchor(poi)) return false;
  // Wildlife is an expiring observation, never a permanent species/location claim.
  if (poi.category === 'wildlife') return Boolean(poi.ebirdLocationId) || activeSeasonalSignals(poi, now).length > 0;
  // Events are strict temporary context: producer records without an explicit
  // freshness cutoff never surface, and an event disappears at that cutoff.
  // `endsAt` is not a substitute because it is not the review/freshness gate.
  if (poi.category === 'event') {
    const expiry = Date.parse(poi.freshnessExpiresAt || '');
    return Number.isFinite(expiry) && now < expiry;
  }
  return true;
}
function sourceUrl(poi) { const source = Array.isArray(poi.source) ? poi.source[0] : poi.source; return typeof source === 'object' ? source?.url : (typeof source === 'string' && /^https?:/i.test(source) ? source : null); }
function historyText(poi) {
  // Producer history is editorial context, not an unsourced assertion.
  if (!historyUrl(poi) && !sourceUrl(poi)) return null;
  return typeof poi.historicalContext === 'string' ? `History: ${poi.historicalContext}` : poi.historicalContext?.text ? `History: ${poi.historicalContext.text}` : null;
}
function historyUrl(poi) { return typeof poi.historicalContext === 'object' ? poi.historicalContext?.url || poi.historicalContext?.sourceUrl : null; }

// A source-wide default coordinate is not a real place location. The NYC
// import assigned many individual signs the same park/borough anchor; keep
// those records out of the map until their individual coordinates are verified
// instead of implying that they are all at one spot.
export function hasReliableMapCoordinate(poi, coordinateCounts = null) {
  if (!Number.isFinite(poi?.lat) || !Number.isFinite(poi?.lng)) return false;
  const duplicates = coordinateCounts instanceof Map
    ? coordinateCounts.get(`${poi.lat},${poi.lng}`)
    : (state.cityPois[state.activeCity] || []).filter((candidate) => candidate.lat === poi.lat && candidate.lng === poi.lng).length;
  return duplicates <= 8;
}

export function openPlaceCluster(cluster, latlng) {
  const places = cluster.getAllChildMarkers().map((marker) => marker.options.place).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if (!places.length) return;
  const container = document.createElement('section');
  container.className = 'place-cluster-list';
  const title = document.createElement('h3');
  title.textContent = `${places.length} places here`;
  container.append(title);
  let shown = 0;
  const appendNext = () => {
    places.slice(shown, shown + 8).forEach((place) => {
      const item = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = place.name;
      const detail = document.createElement('p');
      detail.textContent = place.description || place.historicalContext || place.address || 'Open this place while walking to add your own note.';
      item.append(summary, detail); container.append(item);
    });
    shown = Math.min(shown + 8, places.length);
    if (shown >= places.length) more.remove();
  };
  const more = document.createElement('button');
  more.type = 'button';
  more.textContent = 'Show more places';
  more.addEventListener('click', appendNext);
  container.append(more);
  appendNext();
  L.popup({ maxWidth: 340, className: 'place-cluster-popup' }).setLatLng(latlng).setContent(container).openOn(state.map);
}
