import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES, HISTORY_SUBTYPES, POI_ICONS, POI_TAGS, POI_TAG_PRIORITY, TAG_LABELS } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { distanceMeters } from './geo.js';
import { openSheet } from './ui.js';
import db from './storage.js';
import { canReportPoiClosure, isLocallyClosedPoi, reportPoiClosed } from './spatial-closure-reporting.js';
import { isPoiVisited, markPoiVisited } from './poi-visit-tracking.js';
import { hydrateInlineIcons } from './icon-loader.js';

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
  return poiMatchesSelectedTags(poi, state.poiTags);
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
  const markers = pois
    .filter((poi) => poi.category !== 'journey')
    .filter((poi) => !poiTags(poi).includes('history'))
    .filter(isVisiblePoi)
    .filter((poi) => !isOsmPoi(poi) || !state.poiTags.size || state.poiTags.has('osm'))
    .filter(poiMatchesFilters)
    .filter(withinRenderBounds)
    .map((poi) => {
      const markerTag = primaryPoiTag(poi);
      const icon = L.divIcon({ className: '', html: `<div class="poi-marker ${markerTag}${poi.review?.flags?.length ? ' review-flagged' : ''}"><img data-inline-svg data-icon-fallback="·" src="./icons/${POI_ICONS[markerTag] || 'map-pin'}.svg" alt="" /></div>`, iconSize: [27, 27], iconAnchor: [13, 13] });
      const tagLabels = poiTags(poi).map((tag) => TAG_LABELS[tag] || tag.replaceAll('_', ' ')).join(', ');
      const relevance = poi.walkRelevanceReasons?.length ? `Good walking stop: ${poi.walkRelevanceReasons.join(', ').replaceAll('_', ' ')}` : null;
      const seasonal = activeSeasonalSignals(poi).map((signal) => `Current ${signal.type?.replaceAll('_', ' ') || 'seasonal signal'} through ${new Date(signal.expiresAt).toLocaleDateString()}`).join('<br>');
      const hours = poi.hours ? `Hours: ${typeof poi.hours === 'string' ? poi.hours : JSON.stringify(poi.hours)}` : null;
      const status = poi.status ? `Status: ${poi.status}` : null;
      const eventTiming = poi.startsAt || poi.endsAt ? `Event: ${poi.startsAt || 'date TBA'}${poi.endsAt ? ` – ${poi.endsAt}` : ''}` : null;
      const details = [displayPoiDescription(poi), historyText(poi), poi.address, status, hours, eventTiming, relevance, seasonal, isOsmPoi(poi) ? 'Map data © OpenStreetMap contributors (ODbL)' : null, poi.review?.flags?.length ? 'Needs review' : null, tagLabels ? `Tags: ${tagLabels}` : null].filter(Boolean).map(escapeHtml).join('<br>');
      const links = [poi.link, poi.website, sourceUrl(poi), historyUrl(poi)].filter(Boolean).filter((url, index, all) => all.indexOf(url) === index).map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${index === 0 && (poi.link || poi.website) ? 'Website' : 'Source'} ↗</a>`).join(' · ');
      const closeControl = canReportPoiClosure() ? `<br><button type="button" class="text-button" data-close-poi="${escapeHtml(poi.id)}">Hide as closed for 90 days</button>` : '';
      const visitControl = `<br><button type="button" class="text-button" data-visit-poi="${escapeHtml(poi.id)}"${isPoiVisited(poi) ? ' disabled' : ''}>${isPoiVisited(poi) ? 'Visited' : 'Mark visited'}</button>`;
      const personalControl = `<br><button type="button" class="text-button" data-save-personal-poi="${escapeHtml(poi.id)}">Add to personal places</button>`;
      const marker = L.marker([poi.lat, poi.lng], { icon, title: displayPoiName(poi), interactive: !state.planningMode, place: poi }).bindPopup(`<strong>${escapeHtml(displayPoiName(poi))}</strong>${details ? `<br><span>${details}</span>` : ''}${links ? `<br>${links}` : ''}${visitControl}${personalControl}${closeControl}`);
      marker.on('popupopen', (event) => { const popup = event.popup.getElement(); popup?.querySelector('[data-close-poi]')?.addEventListener('click', async () => {
        try { await reportPoiClosed(poi); state.map.closePopup(); renderCityPois(); } catch (error) { console.warn('Could not record local closure:', error.message); }
      }, { once: true }); popup?.querySelector('[data-visit-poi]')?.addEventListener('click', async () => { await markPoiVisited(poi); state.map.closePopup(); renderCityPois(); }); popup?.querySelector('[data-save-personal-poi]')?.addEventListener('click', () => { state.map.closePopup(); window.dispatchEvent(new CustomEvent('personal-place-create-requested', { detail: { sourcePoi: { ...poi, name: displayPoiName(poi) } } })); }, { once: true }); });
      return marker;
    });
  if (state.poiLayer.addLayers) state.poiLayer.addLayers(markers); else markers.forEach((marker) => marker.addTo(state.poiLayer));
  void hydrateInlineIcons(state.map?.getContainer?.() || document);
  const segments = state.trailSegments[state.activeCity] || [];
  if (!state.poiTags.size || state.poiTags.has('trail')) {
    segments.forEach((segment) => segment.coordinates.forEach((coordinates) => L.polyline(coordinates.map(([lng, lat]) => [lat, lng]), { color: '#2d7259', weight: 5, opacity: .82 }).bindTooltip('Elizabeth River Trail').addTo(state.trailLayer)));
  }
  renderHistorySites();
}
export function renderHistorySites() {
  if (!state.historyLayer) return;
  state.historyLayer.clearLayers();
  if (state.historyRadiusLayer) state.historyRadiusLayer.clearLayers();
  const active = city();
  const allSites = citySites();
  // Build collision counts once. The former per-marker scan made rendering a
  // large city quadratic, which made pan/zoom noticeably sluggish.
  const coordinateCounts = new Map();
  allSites.forEach((site) => {
    const key = `${site.lat},${site.lng}`;
    coordinateCounts.set(key, (coordinateCounts.get(key) || 0) + 1);
  });
  const sites = allSites.filter(isWalkablePoi).filter((site) => !isOsmPoi(site) || !state.poiTags.size || state.poiTags.has('osm')).filter((site) => hasReliableMapCoordinate(site, coordinateCounts)).filter(poiMatchesFilters).filter(withinRenderBounds);
  const markers = sites.map((site) => {
    const subtype = inferHistorySubtype(site);
    const iconName = HISTORY_SUBTYPES[subtype]?.icon || 'building';
    const historyIcon = L.divIcon({
      className: '',
      html: `<div class="historic-pin${site.unverified ? ' unverified' : ''}"><span class="pin-body"><span class="pin-icon"><img data-inline-svg data-icon-fallback="·" src="./icons/${iconName}.svg" alt="" /></span></span></div>`,
      iconSize: [32, 40], iconAnchor: [16, 38]
    });
    const marker = L.marker([site.lat, site.lng], { icon: historyIcon, title: site.name, interactive: !state.planningMode, place: site });
    const subtypeLabel = HISTORY_SUBTYPES[subtype]?.label;
    marker.bindTooltip(site.unverified ? `${site.name} — unverified` : `${site.name}${subtypeLabel ? ` · ${subtypeLabel}` : ''}`, { direction: 'top', offset: [0, -32] });
    marker.on('click', () => { if (!state.planningMode) showHistory(site, distanceMeters(state.currentPosition || active.center, site)); });
    if (state.historyRadiusLayer) {
      L.circle([site.lat, site.lng], { radius: site.radius, stroke: true, weight: 1, color: site.unverified ? '#d4932f' : '#2d7259', opacity: .38, fillColor: site.unverified ? '#d4932f' : '#2d7259', fillOpacity: .06, interactive: false }).addTo(state.historyRadiusLayer);
    }
    return marker;
  });
  if (state.historyLayer.addLayers) state.historyLayer.addLayers(markers); else markers.forEach((marker) => marker.addTo(state.historyLayer));
  void hydrateInlineIcons(state.map?.getContainer?.() || document);
}
export function renderCityExplorer() {
  el('norfolkAttribution').classList.toggle('hidden', state.activeCity !== 'norfolk');
  el('trailFeatureButton').classList.toggle('hidden', !(state.trailSegments[state.activeCity] || []).length);
  updateFiltersBadge();
}







export function normalizePoiTags(poi) {
  const tags = [...(poi.tags || [])];
  if (poi.category && !tags.includes(poi.category)) tags.push(poi.category);
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
  const enabledCategories = new Set(state.settings?.geofenceCategories || GEOFENCE_CATEGORIES.map(([id]) => id));
  return pois.filter((poi) => poiTags(poi).some((tag) => enabledCategories.has(tag)));
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
  if (memory) {
    el('historyReturnBanner').textContent = `You've been here ${memory.visitCount} time${memory.visitCount > 1 ? 's' : ''}. Last note: "${memory.lastNote || 'none yet'}"`;
  }
  el('historyNoteInput').value = '';

  openSheet('historySheet');
}
export async function getPlaceMemory(poiId) {
  return (await db.get('poi_metadata', poiId)) || null;
}

export async function savePlaceMemory(poiId, note = '') {
  const existing = await getPlaceMemory(poiId);
  const record = {
    id: poiId,
    firstVisitDate: existing?.firstVisitDate || new Date().toISOString(),
    visitCount: (existing?.visitCount || 0) + 1,
    lastNote: note || existing?.lastNote || '',
    lastVisitDate: new Date().toISOString()
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
  if (poi.category === 'wildlife') return activeSeasonalSignals(poi, now).length > 0;
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
