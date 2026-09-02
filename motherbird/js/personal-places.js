import { state } from './state.js';
import db from './storage.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml, uid } from './utils.js';
import { closeSheets, openSheet, toast } from './ui.js';
import { hydrateInlineIcons } from './icon-loader.js';
import { markerPinHtml, markerVisual } from './poi-icons.js';
import { requestCompanionContext } from './companion.js';
import {
  postPublicMarker,
  publicMarkerIdentityReady,
  requestPublicMarkerSignIn,
  updatePublicMarker,
  withdrawPublicMarker
} from './online.js';

export const PERSONAL_PLACE_ICONS = [
  ['utensils', 'Food'], ['coffee', 'Coffee'], ['map-pin', 'Place'], ['tree', 'Nature'],
  ['bench', 'Seating'], ['droplet', 'Water'], ['building', 'Building'], ['star', 'Favorite']
];

const ICON_IDS = new Set(PERSONAL_PLACE_ICONS.map(([id]) => id));
const DEFAULT_COLOR = '#E8740F';
const LIGHTS = new Set(['news', 'recreation', 'cuisine', 'personal']);
const CHIP_OPTIONS = {
  recreation: [
    ['routes', 'routes'], ['nature', 'nature'], ['trails', 'trails'], ['historic', 'historic'], ['volunteer', 'volunteer']
  ],
  cuisine: [['cafes', 'cafés'], ['markets', 'markets'], ['restaurants', 'restaurants']]
};
const CHIP_FILTERS = {
  recreation: {
    routes: ['__routes'], nature: ['park', 'nature', 'wildlife', 'water', 'water_access', 'community_garden', 'garden', 'playground', 'dog_park', 'splash_pad', 'rest', 'restrooms', 'drinking_water', 'water_fountain', 'shelter'],
    trails: ['trail'], historic: ['history'], volunteer: ['__volunteer']
  },
  cuisine: {
    cafes: ['coffee', 'coffee_shop', 'cafe'], markets: ['market', 'farmers_market', 'grocery', 'supermarket', 'convenience'], restaurants: ['restaurant', 'fast_food']
  }
};
const publicLeafletMarkers = new Map();

export function slugifyCategory(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54) || `places-${Date.now()}`;
}

export function normalizePersonalCategory(category = {}, now = new Date().toISOString()) {
  const name = String(category.name || category.id || 'My Places').trim().slice(0, 60);
  return {
    id: slugifyCategory(category.id || name),
    name,
    description: String(category.description || '').trim().slice(0, 240),
    icon: ICON_IDS.has(category.icon) ? category.icon : 'map-pin',
    color: /^#[0-9a-f]{6}$/i.test(category.color || '') ? category.color : DEFAULT_COLOR,
    created: category.created || now,
    updatedAt: now
  };
}

export function normalizePersonalPlace(place = {}, now = new Date().toISOString()) {
  const location = place.location || { lat: place.lat, lng: place.lng };
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Choose a valid location for this place.');
  const visibility = ['private', 'friends', 'public'].includes(place.visibility) ? place.visibility : (place.private === false ? 'public' : 'private');
  return {
    ...place,
    id: String(place.id || uid('personal-place')),
    name: String(place.name || '').trim().slice(0, 80),
    location: { lat, lng },
    packId: String(place.packId || place.pack_id || state.activeCity),
    light: LIGHTS.has(place.light) ? place.light : 'personal',
    chipId: place.chipId || place.chip_id || null,
    categoryId: place.categoryId || place.category_id || place.category || null,
    personalCategoryLabel: place.personalCategoryLabel || place.personal_category_label || null,
    notes: String(place.notes || place.description || '').trim().slice(0, 2000),
    photos: Array.isArray(place.photos) ? place.photos : [],
    visibility,
    publicMarkerId: place.publicMarkerId || place.public_marker_id || null,
    publicMarkerStatus: place.publicMarkerStatus || place.public_marker_status || null,
    added: place.added || place.createdAt || now,
    updatedAt: now,
    source: place.source || 'user_manual',
    state: 'saved',
    private: visibility === 'private'
  };
}

export function samePersonalPlace(first, second, thresholdMeters = 18) {
  if (!first?.location || !second?.location) return false;
  return distanceMeters(first.location, second.location) <= thresholdMeters;
}

export function curatedPersonalPlaces(places = state.personalPlaces) {
  return (places || []).filter((place) => place.state === 'saved' || Boolean(place.categoryId || place.category_id));
}

export function defaultPersonalCategoryLabel() {
  const username = String(state.online.remoteProfile?.username || '').trim();
  return username ? `${username}'s places` : 'My Places';
}

export async function ensureDefaultPersonalCategory() {
  const label = defaultPersonalCategoryLabel();
  const id = slugifyCategory(label);
  const existing = state.personalPlaceCategories.find((category) => category.id === id || category.name.toLocaleLowerCase() === label.toLocaleLowerCase());
  if (existing) return existing;
  const category = normalizePersonalCategory({ id, name: label, icon: 'map-pin', color: DEFAULT_COLOR });
  await db.put('personal_place_categories', category);
  state.personalPlaceCategories.push(category);
  if (!(category.id in state.layerFilters.personal)) state.layerFilters.personal[category.id] = true;
  return category;
}

export async function initPersonalPlaces() {
  [state.personalPlaceCategories, state.personalPlaces] = await Promise.all([
    db.all('personal_place_categories'), db.all('personal_places')
  ]);
  await ensureDefaultPersonalCategory();
  if (state.map && !state.personalPlaceLayer) state.personalPlaceLayer = L.layerGroup().addTo(state.map);
  if (state.map && !state.publicMarkerLayer) state.publicMarkerLayer = L.layerGroup().addTo(state.map);
  bindPersonalPlaceControls();
  renderPersonalPlacesPanel();
  renderPersonalPlacesOnMap();
}

function markerChipEnabled(marker) {
  const ids = CHIP_FILTERS[marker.light]?.[marker.chip_id] || [];
  if (marker.chip_id === 'historic') {
    const historyIds = Object.keys(state.layerFilters.public).filter((id) => id === 'history' || id.startsWith('history_'));
    return !historyIds.length || historyIds.some((id) => state.layerFilters.public[id] !== false);
  }
  return ids.some((id) => state.layerFilters.public[id] !== false);
}

function visiblePublicMarker(marker) {
  if (marker.pack_id !== state.activeCity || marker.status === 'withdrawn') return false;
  if (!withinMapBounds({ lat: marker.latitude, lng: marker.longitude })) return false;
  if (marker.light === 'news') return state.layerLights.news && state.layerFilters.public.__low_importance_news === true;
  if (marker.light === 'recreation' || marker.light === 'cuisine') return state.layerLights[marker.light] && markerChipEnabled(marker);
  if (marker.light !== 'personal' || !state.layerLights.personal) return false;
  if (marker.creator_id !== state.online.session?.user?.id) return true;
  const category = state.personalPlaceCategories.find((item) => item.name === marker.personal_category_label);
  return !category || state.layerFilters.personal[category.id] !== false;
}

function markerCategoryLabel(marker) {
  if (marker.light === 'personal') return `MY PLACES · ${marker.personal_category_label || 'places'}`;
  if (marker.light === 'news') return 'NEWS';
  const label = CHIP_OPTIONS[marker.light]?.find(([id]) => id === marker.chip_id)?.[1] || marker.chip_id || marker.light;
  return `${marker.light === 'recreation' ? 'RECREATION' : 'CUISINE'} · ${label}`;
}

function publicMarkerIcon(marker = {}) {
  const collection = state.personalPlaceCategories.find((category) => category.name === marker.personal_category_label);
  return L.divIcon({
    className: '',
    html: markerPinHtml(markerVisual({ light: marker.light || 'personal', chipId: marker.chip_id || marker.chipId, collectionIcon: marker.collectionIcon || collection?.icon })),
    iconSize: [27, 27], iconAnchor: [13, 13]
  });
}

function publicMarkerPopup(marker) {
  const mine = marker.creator_id === state.online.session?.user?.id;
  const name = marker.name ? `<strong>${escapeHtml(marker.name)}</strong><br>` : '';
  const attribution = mine ? `You — ${relativeAge(marker.created_at)}` : `@${marker.creator_username}`;
  return `${name}<small>${escapeHtml(attribution)}<br>${escapeHtml(markerCategoryLabel(marker))}</small>${mine ? `<br><button class="text-button" type="button" data-edit-public-marker="${escapeHtml(marker.id)}">Edit</button>` : ''}`;
}

function relativeAge(value) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value || ''));
  if (!Number.isFinite(elapsed)) return 'now';
  const days = Math.floor(elapsed / 86400000);
  if (days) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(elapsed / 3600000);
  return hours ? `${hours} hour${hours === 1 ? '' : 's'} ago` : 'now';
}

function bindPublicMarkerPopup(leafletMarker, marker) {
  leafletMarker.on('popupopen', (event) => {
    const popup = event.popup.getElement();
    popup?.querySelector('[data-edit-public-marker]')?.addEventListener('click', () => {
      const local = curatedPersonalPlaces().find((place) => place.publicMarkerId === marker.id);
      openPersonalPlaceForm({ editId: local?.id || null, publicMarkerId: marker.id });
    });
  });
}

export function renderPersonalPlacesOnMap() {
  if (!state.map) return;
  if (!state.personalPlaceLayer) state.personalPlaceLayer = L.layerGroup().addTo(state.map);
  if (!state.publicMarkerLayer) state.publicMarkerLayer = L.layerGroup().addTo(state.map);
  state.personalPlaceLayer.clearLayers();
  state.publicMarkerLayer.clearLayers();
  publicLeafletMarkers.clear();

  const categories = new Map(state.personalPlaceCategories.map((category) => [category.id, category]));
  curatedPersonalPlaces().filter((place) => {
      const categoryId = place.categoryId || place.category_id;
      if (place.publicMarkerId || (place.packId && place.packId !== state.activeCity) || !withinMapBounds(place.location)) return false;
      if ((place.light || 'personal') === 'personal') return categoryId && categories.has(categoryId) && state.layerLights.personal && state.layerFilters.personal[categoryId] !== false;
      if (place.light === 'news') return state.layerLights.news && state.layerFilters.public.__low_importance_news === true;
      return state.layerLights[place.light] && markerChipEnabled({ light: place.light, chip_id: place.chipId });
    }).forEach((place) => {
      const category = categories.get(place.categoryId || place.category_id);
      const icon = publicMarkerIcon({ light: place.light || 'personal', chipId: place.chipId, collectionIcon: category?.icon });
      const marker = L.marker([place.location.lat, place.location.lng], { icon, title: place.name || '' });
      const name = place.name ? `<strong>${escapeHtml(place.name)}</strong><br>` : '';
      const chip = (place.light || 'personal') === 'personal' ? (category?.name || 'MY PLACES') : markerCategoryLabel({ light: place.light, chip_id: place.chipId });
      marker.bindPopup(`${name}<small>You — ${escapeHtml(relativeAge(place.added))}<br>${escapeHtml(chip)}</small><br><button class="text-button" type="button" data-edit-personal-place="${escapeHtml(place.id)}">Edit</button>`);
      marker.on('popupopen', (event) => event.popup.getElement()?.querySelector('[data-edit-personal-place]')?.addEventListener('click', () => openPersonalPlaceForm({ editId: place.id }), { once: true }));
      marker.addTo(state.personalPlaceLayer);
  });

  state.publicMarkers.filter(visiblePublicMarker).forEach((marker) => {
    const leafletMarker = L.marker([marker.latitude, marker.longitude], { icon: publicMarkerIcon(marker), title: marker.name });
    leafletMarker.bindPopup(publicMarkerPopup(marker));
    bindPublicMarkerPopup(leafletMarker, marker);
    leafletMarker.addTo(state.publicMarkerLayer);
    publicLeafletMarkers.set(marker.id, leafletMarker);
  });
}

function withinMapBounds(location) {
  if (!state.map) return true;
  try { return state.map.getBounds().pad(0.6).contains([location.lat, location.lng]); } catch { return true; }
}

function localCategory(place) {
  return state.personalPlaceCategories.find((category) => category.id === (place.categoryId || place.category_id));
}

export function renderPersonalPlacesPanel() {
  const panel = el('personalPlacesPanel');
  if (!panel) return;
  const places = curatedPersonalPlaces();
  const cards = state.personalPlaceCategories.map((category) => {
    const inCategory = places.filter((place) => (place.categoryId || place.category_id) === category.id);
    const visible = state.layerFilters.personal[category.id] !== false;
    const rows = inCategory.length ? inCategory.map((place) => {
      const destination = (place.light || 'personal') === 'personal' ? category.name : markerCategoryLabel({ light: place.light, chip_id: place.chipId });
      const status = place.publicMarkerId ? `Posted ${place.visibility}` : 'Private on this device';
      return `<li><span><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(destination)} · ${escapeHtml(status)}</small></span><button class="text-button" type="button" data-edit-personal-place="${escapeHtml(place.id)}">Edit</button>${place.publicMarkerId ? `<button class="text-button danger-button" type="button" data-withdraw-owned-marker="${escapeHtml(place.publicMarkerId)}">Withdraw</button>` : ''}</li>`;
    }).join('') : '<li class="personal-place-empty">No locations in this category yet.</li>';
    return `<article class="personal-category-card" style="--category-color:${escapeHtml(category.color)}"><header><span class="category-icon"><img data-inline-svg data-icon-fallback="" src="./icons/${escapeHtml(category.icon)}.svg" alt="" /></span><span><h3>${escapeHtml(category.name)}</h3><small>${inCategory.length} place${inCategory.length === 1 ? '' : 's'} · ${visible ? 'shown on map' : 'hidden on map'}</small></span></header>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}<label class="personal-map-toggle"><input type="checkbox" data-personal-category-visible="${escapeHtml(category.id)}" ${visible ? 'checked' : ''} /> Show this category on the map</label><ul>${rows}</ul><button class="secondary-button" type="button" data-add-to-personal-category="${escapeHtml(category.id)}">Add location</button></article>`;
  }).join('');
  panel.innerHTML = `<div class="personal-places-intro"><div><p class="eyebrow">MY PLACES</p><h2>Your places</h2><p>Private pins stay on this device. Posted pins keep their attribution.</p></div><button class="primary-button" id="addPersonalPlaceButton" type="button"><img src="./icons/plus.svg" alt="" /> Add location</button></div>${cards}<div class="personal-place-transfer"><button class="secondary-button" id="exportPersonalPlacesButton" type="button">Export all personal places</button><button class="secondary-button" id="importPersonalPlacesButton" type="button">Import from file</button></div>`;
  void hydrateInlineIcons(panel);
}

function defaultChip(light) {
  return CHIP_OPTIONS[light]?.[0]?.[0] || '';
}

function selectedDestination() {
  return document.querySelector('input[name="personalPlaceDestination"]:checked')?.value || 'personal';
}

function readFormDraft() {
  const light = selectedDestination();
  return {
    editId: el('personalPlaceForm').dataset.editId || null,
    publicMarkerId: el('personalPlaceForm').dataset.publicMarkerId || null,
    light,
    chipId: ['recreation', 'cuisine'].includes(light) ? el('personalPlaceChip').value : null,
    categoryId: light === 'personal' ? el('personalPlaceCategory').value : (el('personalPlaceForm').dataset.managementCategoryId || null),
    newCategoryName: el('personalPlaceNewCategoryName').value,
    visibility: el('personalPlaceVisibility').value,
    name: el('personalPlaceName').value,
    notes: el('personalPlaceNotes').value,
    location: locationFromForm()
  };
}

function locationFromForm() {
  const latValue = el('personalPlaceLatitude').value;
  const lngValue = el('personalPlaceLongitude').value;
  if (latValue === '' || lngValue === '') return null;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function populateCategorySelect(selectedId) {
  const select = el('personalPlaceCategory');
  select.innerHTML = `${state.personalPlaceCategories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}<option value="__new__">+ New category</option>`;
  select.value = state.personalPlaceCategories.some((category) => category.id === selectedId) ? selectedId : (state.personalPlaceCategories.at(-1)?.id || '__new__');
}

function populateChipSelect(light, selectedId) {
  const options = CHIP_OPTIONS[light] || [];
  el('personalPlaceChip').innerHTML = options.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  el('personalPlaceChip').value = options.some(([id]) => id === selectedId) ? selectedId : defaultChip(light);
}

function renderPersonalPlaceFormState() {
  const form = el('personalPlaceForm');
  const light = selectedDestination();
  const editingPublic = Boolean(form.dataset.publicMarkerId);
  const hasLocation = Boolean(locationFromForm());
  el('personalPlaceChipRow').classList.toggle('hidden', !['recreation', 'cuisine'].includes(light));
  el('personalPlaceCategoryRow').classList.toggle('hidden', light !== 'personal');
  el('personalPlaceVisibilityRow').classList.remove('hidden');
  el('personalPlaceNewCategoryFields').classList.toggle('hidden', light !== 'personal' || el('personalPlaceCategory').value !== '__new__');
  document.querySelector('.personal-place-destination-step')?.classList.toggle('hidden', editingPublic);
  el('personalPlaceChooseLocation').classList.toggle('hidden', editingPublic);
  el('personalPlaceDetails').classList.toggle('hidden', !hasLocation && !editingPublic);
  el('personalPlaceLocationStatus').textContent = hasLocation ? 'Location ready' : 'Choose a destination, then drop the crosshair.';
  el('personalPlaceSubmit').disabled = !hasLocation;
  el('personalPlaceSubmit').textContent = editingPublic ? 'Save Post' : (light === 'personal' && el('personalPlaceVisibility').value === 'private' ? 'Save' : 'Post');
}

export function openPersonalPlaceForm({ editId = null, publicMarkerId = null, categoryId = null, sourcePoi = null, location = null, draft = null } = {}) {
  const place = editId ? curatedPersonalPlaces().find((candidate) => candidate.id === editId) : null;
  const marker = publicMarkerId ? state.publicMarkers.find((candidate) => candidate.id === publicMarkerId) : (place?.publicMarkerId ? state.publicMarkers.find((candidate) => candidate.id === place.publicMarkerId) : null);
  const saved = draft || state.personalPlaceDraft || {};
  const point = location || saved.location || place?.location || (marker ? { lat: marker.latitude, lng: marker.longitude } : sourcePoi && { lat: sourcePoi.lat, lng: sourcePoi.lng });
  const light = marker?.light || place?.light || saved.light || 'personal';
  const form = el('personalPlaceForm');
  form.reset();
  form.dataset.editId = place?.id || saved.editId || '';
  form.dataset.publicMarkerId = marker?.id || place?.publicMarkerId || saved.publicMarkerId || '';
  form.dataset.sourcePoiId = sourcePoi?.id || place?.sourcePoiId || '';
  form.dataset.managementCategoryId = place?.categoryId || categoryId || saved.categoryId || '';
  el('personalPlaceFormTitle').textContent = marker ? 'Edit Post' : (place ? 'Edit location' : 'Add Location');
  document.querySelectorAll('input[name="personalPlaceDestination"]').forEach((input) => { input.checked = input.value === light; input.disabled = Boolean(marker); });
  populateChipSelect(light, marker?.chip_id || place?.chipId || saved.chipId);
  populateCategorySelect(place?.categoryId || categoryId || saved.categoryId);
  el('personalPlaceNewCategoryName').value = saved.newCategoryName || '';
  el('personalPlaceVisibility').value = place?.visibility || marker?.status || saved.visibility || state.settings.defaultPinVisibility || 'private';
  el('personalPlaceName').value = marker?.name || place?.name || saved.name || '';
  el('personalPlaceNotes').value = marker?.description || place?.notes || saved.notes || '';
  el('personalPlaceLatitude').value = Number.isFinite(Number(point?.lat)) ? Number(point.lat).toFixed(6) : '';
  el('personalPlaceLongitude').value = Number.isFinite(Number(point?.lng)) ? Number(point.lng).toFixed(6) : '';
  state.personalPlaceDraft = null;
  renderPersonalPlaceFormState();
  openSheet('personalPlaceSheet');
  if (point) el('personalPlaceName').focus();
}

function armPersonalPlaceCrosshair() {
  state.personalPlaceDraft = readFormDraft();
  state.personalPlaceDraft.location = null;
  state.personalPlaceSelecting = true;
  document.body.classList.add('placing-personal-place');
  closeSheets();
  el('savePlaceMapButton').innerHTML = '<img class="ui-icon ui-icon--small" src="./icons/map-pin.svg" alt="" /> Use this spot';
  el('savePlaceMapButton').setAttribute('aria-label', 'Use the crosshair position for this Post');
  toast('Move the map under the crosshair, then choose “Use this spot.”');
}

function finishPersonalPlaceCrosshair(location) {
  state.personalPlaceSelecting = false;
  document.body.classList.remove('placing-personal-place');
  el('savePlaceMapButton').innerHTML = '<img class="ui-icon ui-icon--small" src="./icons/plus.svg" alt="" /> Add Location';
  el('savePlaceMapButton').setAttribute('aria-label', 'Add a location');
  const draft = { ...(state.personalPlaceDraft || {}), location };
  state.personalPlaceDraft = null;
  openPersonalPlaceForm({ draft });
}

async function categoryForDraft(draft) {
  let categoryId = draft.categoryId;
  if (categoryId === '__new__') {
    if (!draft.newCategoryName.trim()) throw new Error('Name the new category first.');
    const category = normalizePersonalCategory({ name: draft.newCategoryName });
    category.id = uniqueCategoryId(category.id);
    await db.put('personal_place_categories', category);
    state.personalPlaceCategories.push(category);
    categoryId = category.id;
  }
  const category = state.personalPlaceCategories.find((candidate) => candidate.id === categoryId) || await ensureDefaultPersonalCategory();
  return category;
}

async function savePersonalPlace(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const draft = readFormDraft();
  if (!draft.location) { toast('Drop the crosshair before saving.'); return; }
  const existing = curatedPersonalPlaces().find((place) => place.id === draft.editId);
  const marker = draft.publicMarkerId ? state.publicMarkers.find((candidate) => candidate.id === draft.publicMarkerId) : null;
  let managementCategory;
  try { managementCategory = await categoryForDraft({ ...draft, categoryId: draft.light === 'personal' ? draft.categoryId : (existing?.categoryId || draft.categoryId) }); }
  catch (error) { toast(error.message); return; }
  const name = String(draft.name || '').trim().slice(0, 80);
  const notes = String(draft.notes || '').trim().slice(0, 500);

  let publicRecord = marker;
  if (draft.publicMarkerId) {
    try { publicRecord = draft.visibility === 'private' ? (await withdrawPublicMarker(draft.publicMarkerId), null) : await updatePublicMarker(draft.publicMarkerId, { name, description: notes, status: draft.visibility }); }
    catch (error) { toast(error.message || 'That Post could not be updated.'); return; }
  }

  let savedLight = draft.light;
  let savedChip = draft.chipId;
  let savedVisibility = draft.visibility;
  let savedCategory = managementCategory;
  let downgradedToPrivate = false;

  if (!draft.publicMarkerId && draft.visibility !== 'private') {
    if (!publicMarkerIdentityReady() || globalThis.navigator?.onLine === false) downgradedToPrivate = true;
    else {
      try {
        publicRecord = await postPublicMarker({
          pack_id: state.activeCity,
          name,
          description: notes,
          latitude: draft.location.lat,
          longitude: draft.location.lng,
          light: draft.light,
          chip_id: ['recreation', 'cuisine'].includes(draft.light) ? draft.chipId : null,
          personal_category_label: draft.light === 'personal' ? managementCategory.name : null,
          status: draft.visibility
        });
      } catch (error) {
        if (!['MARKER_AUTH_REQUIRED', 'MARKER_OFFLINE'].includes(error.code)) console.warn('Post failed:', error.message);
        downgradedToPrivate = true;
      }
    }
  }

  if (downgradedToPrivate) {
    savedCategory = await ensureDefaultPersonalCategory();
    savedLight = 'personal';
    savedChip = null;
    savedVisibility = 'private';
  }

  const place = normalizePersonalPlace({
    ...(existing || {}),
    name,
    location: draft.location,
    packId: state.activeCity,
    light: savedLight,
    chipId: savedChip,
    categoryId: savedCategory.id,
    personalCategoryLabel: savedLight === 'personal' ? savedCategory.name : null,
    notes,
    visibility: savedVisibility,
    publicMarkerId: draft.publicMarkerId && !publicRecord ? null : (publicRecord?.id || existing?.publicMarkerId || null),
    publicMarkerStatus: draft.publicMarkerId && !publicRecord ? 'withdrawn' : (publicRecord?.status || existing?.publicMarkerStatus || null),
    source: form.dataset.sourcePoiId ? 'pack_place' : existing?.source,
    sourcePoiId: form.dataset.sourcePoiId || existing?.sourcePoiId || null
  });
  await db.put('personal_places', place);
  state.personalPlaces = [...state.personalPlaces.filter((candidate) => candidate.id !== place.id), place];
  state.layerFilters.personal[savedCategory.id] = true;
  state.layerLights[savedLight] = true;
  state.layerUiState.lightExpanded = savedLight;
  requestCompanionContext('journal');
  personalDataChanged();
  closeSheets();
  if (downgradedToPrivate) {
    toast(publicMarkerIdentityReady() ? 'Post needs a network connection. The pin stayed private on this device.' : 'Post needs sign-in and a username. The pin stayed private on this device.');
    if (!publicMarkerIdentityReady()) void requestPublicMarkerSignIn();
  } else toast(publicRecord ? (name ? `${name} posted.` : 'Pin posted.') : (name ? `${name} saved on this device.` : 'Pin saved on this device.'));
}

function uniqueCategoryId(base) {
  let id = base; let suffix = 2;
  const ids = new Set(state.personalPlaceCategories.map((category) => category.id));
  while (ids.has(id)) { id = `${base}-${suffix}`; suffix += 1; }
  return id;
}

async function uncategorize(placeId) {
  const place = state.personalPlaces.find((item) => item.id === placeId);
  if (!place) return;
  const updated = { ...place, categoryId: null, updatedAt: new Date().toISOString() };
  await db.put('personal_places', updated);
  state.personalPlaces = state.personalPlaces.map((item) => item.id === placeId ? updated : item);
  personalDataChanged();
  toast('Removed from this category. The saved location was not deleted.');
}

async function withdrawOwnedMarker(markerId) {
  try { await withdrawPublicMarker(markerId); }
  catch (error) { toast(error.message || 'That Post could not be withdrawn.'); return; }
  const local = state.personalPlaces.find((place) => place.publicMarkerId === markerId);
  if (local) {
    const category = localCategory(local) || await ensureDefaultPersonalCategory();
    const updated = normalizePersonalPlace({ ...local, light: 'personal', chipId: null, categoryId: category.id, personalCategoryLabel: category.name, visibility: 'private', publicMarkerId: null, publicMarkerStatus: 'withdrawn' });
    await db.put('personal_places', updated);
    state.personalPlaces = state.personalPlaces.map((place) => place.id === updated.id ? updated : place);
  }
  state.layerLights.personal = true;
  personalDataChanged();
  toast('Post withdrawn. Its private device copy remains in MY PLACES.');
}

function personalDataChanged() {
  renderPersonalPlacesPanel(); renderPersonalPlacesOnMap();
  window.dispatchEvent(new CustomEvent('personal-places-changed'));
}

export function personalPlacesExportPayload(now = new Date().toISOString()) {
  return {
    name: 'My personal places', version: '1.0', created: now,
    personal_place_categories: state.personalPlaceCategories.map(({ updatedAt, ...category }) => category),
    personal_places_data: curatedPersonalPlaces().map(({ photos, private: _private, state: _state, updatedAt, publicMarkerId: _marker, publicMarkerStatus: _markerStatus, ...place }) => ({ ...place, photos: [], visibility: 'private' })),
    export_format: 'walk-wildlife-personal-places-v1'
  };
}

function exportPersonalPlaces() {
  const payload = personalPlacesExportPayload();
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'my-personal-places.walkplaces'; link.click(); URL.revokeObjectURL(url);
  toast('Personal places exported without photos or cloud Post links.');
}

export async function upsertImportedPersonalData(categories = [], places = [], duplicateStrategy = 'skip') {
  const now = new Date().toISOString();
  const categoryMap = new Map();
  for (const raw of categories) {
    const normalized = normalizePersonalCategory(raw, now);
    const existing = state.personalPlaceCategories.find((item) => item.id === normalized.id);
    const target = existing || { ...normalized, id: uniqueCategoryId(normalized.id) };
    categoryMap.set(raw.id || raw.name, target.id);
    if (!existing) { await db.put('personal_place_categories', target); state.personalPlaceCategories.push(target); }
  }
  let added = 0; let merged = 0; let skipped = 0;
  for (const raw of places) {
    const categoryId = categoryMap.get(raw.categoryId || raw.category_id || raw.category) || raw.categoryId || raw.category_id || raw.category;
    const candidate = normalizePersonalPlace({ ...raw, light: 'personal', chipId: null, visibility: 'private', publicMarkerId: null, categoryId, personalCategoryLabel: state.personalPlaceCategories.find((category) => category.id === categoryId)?.name || null }, now);
    const duplicate = curatedPersonalPlaces().find((place) => samePersonalPlace(place, candidate));
    if (duplicate && duplicateStrategy === 'skip') { skipped += 1; continue; }
    const saved = duplicate ? normalizePersonalPlace({ ...duplicate, notes: [duplicate.notes, candidate.notes].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join('\n'), categoryId: candidate.categoryId || duplicate.categoryId }, now) : { ...candidate, id: state.personalPlaces.some((place) => place.id === candidate.id) ? uid('personal-place') : candidate.id };
    await db.put('personal_places', saved);
    state.personalPlaces = [...state.personalPlaces.filter((place) => place.id !== saved.id), saved];
    if (duplicate) merged += 1; else added += 1;
  }
  personalDataChanged();
  return { added, merged, skipped };
}

function bindPersonalPlaceControls() {
  el('personalPlacesPanel')?.addEventListener('click', (event) => {
    if (event.target.closest('#addPersonalPlaceButton')) { openPersonalPlaceForm(); return; }
    if (event.target.closest('#exportPersonalPlacesButton')) { exportPersonalPlaces(); return; }
    if (event.target.closest('#importPersonalPlacesButton')) { window.dispatchEvent(new CustomEvent('filter-import-requested')); return; }
    const add = event.target.closest('[data-add-to-personal-category]'); if (add) { openPersonalPlaceForm({ categoryId: add.dataset.addToPersonalCategory }); return; }
    const editPlace = event.target.closest('[data-edit-personal-place]'); if (editPlace) { openPersonalPlaceForm({ editId: editPlace.dataset.editPersonalPlace }); return; }
    const withdraw = event.target.closest('[data-withdraw-owned-marker]'); if (withdraw) { void withdrawOwnedMarker(withdraw.dataset.withdrawOwnedMarker); return; }
    const remove = event.target.closest('[data-uncategorize-personal-place]'); if (remove) void uncategorize(remove.dataset.uncategorizePersonalPlace);
  });
  el('personalPlacesPanel')?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-personal-category-visible]'); if (!input) return;
    state.layerFilters.personal[input.dataset.personalCategoryVisible] = input.checked;
    personalDataChanged(); window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  });
  el('personalPlaceForm')?.addEventListener('submit', (event) => void savePersonalPlace(event));
  el('personalPlaceForm')?.addEventListener('change', (event) => {
    if (event.target.matches('input[name="personalPlaceDestination"]')) populateChipSelect(event.target.value, defaultChip(event.target.value));
    renderPersonalPlaceFormState();
  });
  el('personalPlaceChooseLocation')?.addEventListener('click', armPersonalPlaceCrosshair);
  window.addEventListener('personal-place-create-requested', (event) => openPersonalPlaceForm(event.detail || {}));
  window.addEventListener('personal-place-location-selected', (event) => finishPersonalPlaceCrosshair(event.detail));
  window.addEventListener('public-marker-focus-requested', (event) => {
    const marker = state.publicMarkers.find((candidate) => candidate.id === event.detail?.markerId);
    if (!marker) return;
    state.map.flyTo([marker.latitude, marker.longitude], Math.max(state.map.getZoom(), 16));
    setTimeout(() => publicLeafletMarkers.get(marker.id)?.openPopup(), 350);
  });
  window.addEventListener('public-markers-changed', () => { renderPersonalPlacesPanel(); renderPersonalPlacesOnMap(); });
  window.addEventListener('online-profile-changed', async () => { await ensureDefaultPersonalCategory(); personalDataChanged(); });
  window.addEventListener('personal-places-changed', async () => {
    if (state.personalPlaceCategories.length) return;
    await ensureDefaultPersonalCategory();
    renderPersonalPlacesPanel();
    window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  });
  window.addEventListener('map-viewport-changed', renderPersonalPlacesOnMap);
}
