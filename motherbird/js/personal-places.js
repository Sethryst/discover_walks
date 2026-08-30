import { state } from './state.js';
import db from './storage.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml, uid } from './utils.js';
import { closeSheets, openSheet, showView, toast } from './ui.js';
import { hydrateInlineIcons } from './icon-loader.js';
import { requestCompanionContext } from './companion.js';

export const PERSONAL_PLACE_ICONS = [
  ['utensils', 'Food'], ['coffee', 'Coffee'], ['map-pin', 'Place'], ['tree', 'Nature'],
  ['bench', 'Seating'], ['droplet', 'Water'], ['building', 'Building'], ['star', 'Favorite']
];

const ICON_IDS = new Set(PERSONAL_PLACE_ICONS.map(([id]) => id));
const DEFAULT_COLOR = '#E8740F';

export function slugifyCategory(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54) || `places-${Date.now()}`;
}

export function normalizePersonalCategory(category = {}, now = new Date().toISOString()) {
  const name = String(category.name || category.id || 'My places').trim().slice(0, 60);
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
  return {
    ...place,
    id: String(place.id || uid('personal-place')),
    name: String(place.name || 'Saved place').trim().slice(0, 100),
    address: String(place.address || '').trim().slice(0, 240),
    location: { lat, lng },
    categoryId: place.categoryId || place.category_id || place.category || null,
    notes: String(place.notes || '').trim().slice(0, 2000),
    photos: Array.isArray(place.photos) ? place.photos : [],
    added: place.added || place.createdAt || now,
    updatedAt: now,
    source: place.source || 'user_manual',
    state: 'saved',
    private: true
  };
}

export function samePersonalPlace(first, second, thresholdMeters = 18) {
  if (!first?.location || !second?.location) return false;
  return distanceMeters(first.location, second.location) <= thresholdMeters;
}

export function curatedPersonalPlaces(places = state.personalPlaces) {
  return (places || []).filter((place) => place.state === 'saved' || Boolean(place.categoryId || place.category_id));
}

export async function initPersonalPlaces() {
  [state.personalPlaceCategories, state.personalPlaces] = await Promise.all([
    db.all('personal_place_categories'), db.all('personal_places')
  ]);
  if (state.map && !state.personalPlaceLayer) state.personalPlaceLayer = L.layerGroup().addTo(state.map);
  bindPersonalPlaceControls();
  renderPersonalPlacesPanel();
  renderPersonalPlacesOnMap();
}

export function renderPersonalPlacesOnMap() {
  if (!state.personalPlaceLayer) return;
  state.personalPlaceLayer.clearLayers();
  const categories = new Map(state.personalPlaceCategories.map((category) => [category.id, category]));
  curatedPersonalPlaces().filter((place) => {
    const categoryId = place.categoryId || place.category_id;
    return categoryId && categories.has(categoryId) && state.layerFilters.personal[categoryId] !== false && withinMapBounds(place.location);
  }).forEach((place) => {
    const category = categories.get(place.categoryId || place.category_id);
    const iconName = ICON_IDS.has(category.icon) ? category.icon : 'map-pin';
    const icon = L.divIcon({
      className: '',
      html: `<div class="personal-place-marker" style="--marker-color:${escapeHtml(category.color)}"><img data-inline-svg data-icon-fallback="·" src="./icons/${iconName}.svg" alt="" /></div>`,
      iconSize: [34, 40], iconAnchor: [17, 37]
    });
    const marker = L.marker([place.location.lat, place.location.lng], { icon, title: place.name });
    marker.bindPopup(`<strong>${escapeHtml(place.name)}</strong><br><small>${escapeHtml(category.name)} · Personal place</small>${place.notes ? `<br><span>${escapeHtml(place.notes)}</span>` : ''}<br><button class="text-button" type="button" data-edit-personal-place="${escapeHtml(place.id)}">Edit your place</button>`);
    marker.on('popupopen', (event) => event.popup.getElement()?.querySelector('[data-edit-personal-place]')?.addEventListener('click', () => openPersonalPlaceForm({ editId: place.id }), { once: true }));
    marker.addTo(state.personalPlaceLayer);
  });
  void hydrateInlineIcons(state.map?.getContainer?.() || document);
}

function withinMapBounds(location) {
  if (!state.map) return true;
  try { return state.map.getBounds().pad(0.6).contains([location.lat, location.lng]); } catch { return true; }
}

export function renderPersonalPlacesPanel() {
  const panel = el('personalPlacesPanel');
  if (!panel) return;
  const places = curatedPersonalPlaces();
  const cards = state.personalPlaceCategories.map((category) => {
    const inCategory = places.filter((place) => (place.categoryId || place.category_id) === category.id);
    const visible = state.layerFilters.personal[category.id] !== false;
    const rows = inCategory.length ? inCategory.map((place) => `<li><span><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.address || (place.source === 'osm_import' ? 'OpenStreetMap place' : 'Personally added'))} · ${new Date(place.added || place.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></span><button class="text-button" type="button" data-edit-personal-place="${escapeHtml(place.id)}">Edit</button><button class="text-button" type="button" data-uncategorize-personal-place="${escapeHtml(place.id)}">Remove</button></li>`).join('') : '<li class="personal-place-empty">No locations in this collection yet.</li>';
    return `<article class="personal-category-card" style="--category-color:${escapeHtml(category.color)}"><header><span class="category-icon"><img data-inline-svg data-icon-fallback="" src="./icons/${escapeHtml(category.icon)}.svg" alt="" /></span><span><h3>${escapeHtml(category.name)}</h3><small>${inCategory.length} place${inCategory.length === 1 ? '' : 's'} · ${visible ? 'shown on map' : 'hidden on map'}</small></span><button class="text-button" type="button" data-edit-personal-category="${escapeHtml(category.id)}">Edit</button></header>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}<label class="personal-map-toggle"><input type="checkbox" data-personal-category-visible="${escapeHtml(category.id)}" ${visible ? 'checked' : ''} /> Show this collection on the map</label><ul>${rows}</ul><button class="secondary-button" type="button" data-add-to-personal-category="${escapeHtml(category.id)}">Add location</button></article>`;
  }).join('');
  panel.innerHTML = `<div class="personal-places-intro"><div><p class="eyebrow">CURATED CUISINES &amp; SPOTS</p><h2>Your places, your map</h2><p>Private collections saved in this browser. They stay separate from public map data until you export them.</p></div><button class="primary-button" id="addPersonalPlaceButton" type="button"><img src="./icons/plus.svg" alt="" /> Add new place</button></div>${cards || '<div class="empty-state"><strong>No personal collections yet.</strong>Add a place and create the first collection around what matters to you.</div>'}<div class="personal-place-transfer"><button class="secondary-button" id="exportPersonalPlacesButton" type="button">Export all personal places</button><button class="secondary-button" id="importPersonalPlacesButton" type="button">Import from file</button></div>`;
  void hydrateInlineIcons(panel);
}

export function openPersonalPlaceForm({ editId = null, categoryId = null, sourcePoi = null, location = null } = {}) {
  const place = editId ? curatedPersonalPlaces().find((candidate) => candidate.id === editId) : null;
  const fallbackCenter = location || state.currentPosition || (state.map ? { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng } : { lat: 0, lng: 0 });
  const point = place?.location || sourcePoi || fallbackCenter;
  const form = el('personalPlaceForm');
  form.reset();
  form.dataset.editId = place?.id || '';
  form.dataset.sourcePoiId = sourcePoi?.id || place?.sourcePoiId || '';
  el('personalPlaceFormTitle').textContent = place ? 'Edit personal place' : 'Add a personal place';
  el('personalPlaceName').value = place?.name || sourcePoi?.name || '';
  el('personalPlaceAddress').value = place?.address || sourcePoi?.address || '';
  el('personalPlaceLatitude').value = Number(point?.lat).toFixed(6);
  el('personalPlaceLongitude').value = Number(point?.lng).toFixed(6);
  el('personalPlaceNotes').value = place?.notes || '';
  el('personalPlaceCategory').innerHTML = `${state.personalPlaceCategories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}<option value="__new__">+ Create new category</option>`;
  el('personalPlaceCategory').value = place?.categoryId || place?.category_id || categoryId || state.personalPlaceCategories[0]?.id || '__new__';
  renderNewCategoryFields();
  el('personalPlacePhotoStatus').textContent = place?.photos?.length ? `${place.photos.length} saved photo${place.photos.length === 1 ? '' : 's'}` : 'Optional · private on this device';
  openSheet('personalPlaceSheet');
  el('personalPlaceName').focus();
}

function renderNewCategoryFields() {
  el('personalPlaceNewCategoryFields').classList.toggle('hidden', el('personalPlaceCategory').value !== '__new__');
}

async function savePersonalPlace(event) {
  event.preventDefault();
  let categoryId = el('personalPlaceCategory').value;
  if (categoryId === '__new__') {
    const category = normalizePersonalCategory({ name: el('personalPlaceNewCategoryName').value, icon: el('personalPlaceNewCategoryIcon').value, color: el('personalPlaceNewCategoryColor').value });
    if (!el('personalPlaceNewCategoryName').value.trim()) { toast('Name the new collection first.'); return; }
    category.id = uniqueCategoryId(category.id);
    await db.put('personal_place_categories', category);
    state.personalPlaceCategories.push(category);
    categoryId = category.id;
  }
  const existing = curatedPersonalPlaces().find((place) => place.id === event.currentTarget.dataset.editId);
  const files = [...el('personalPlacePhotos').files];
  const photos = files.length ? await Promise.all(files.map(fileAsDataUrl)) : (existing?.photos || []);
  const place = normalizePersonalPlace({
    ...(existing || {}),
    name: el('personalPlaceName').value,
    address: el('personalPlaceAddress').value,
    location: { lat: Number(el('personalPlaceLatitude').value), lng: Number(el('personalPlaceLongitude').value) },
    categoryId,
    notes: el('personalPlaceNotes').value,
    photos,
    source: event.currentTarget.dataset.sourcePoiId ? 'osm_import' : existing?.source,
    sourcePoiId: event.currentTarget.dataset.sourcePoiId || existing?.sourcePoiId || null
  });
  await db.put('personal_places', place);
  requestCompanionContext('journal');
  state.personalPlaces = [...state.personalPlaces.filter((candidate) => candidate.id !== place.id), place];
  if (!(categoryId in state.layerFilters.personal)) state.layerFilters.personal[categoryId] = true;
  personalDataChanged();
  closeSheets();
  toast(`${place.name} saved to your personal map.`);
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result }); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}

function uniqueCategoryId(base) {
  let id = base; let suffix = 2;
  const ids = new Set(state.personalPlaceCategories.map((category) => category.id));
  while (ids.has(id)) { id = `${base}-${suffix}`; suffix += 1; }
  return id;
}

function openCategoryEditor(categoryId) {
  const category = state.personalPlaceCategories.find((item) => item.id === categoryId);
  if (!category) return;
  const form = el('personalCategoryForm');
  form.dataset.categoryId = category.id;
  el('personalCategoryName').value = category.name;
  el('personalCategoryDescription').value = category.description || '';
  el('personalCategoryIcon').value = category.icon;
  el('personalCategoryColor').value = category.color;
  openSheet('personalCategorySheet');
}

async function saveCategory(event) {
  event.preventDefault();
  const existing = state.personalPlaceCategories.find((category) => category.id === event.currentTarget.dataset.categoryId);
  const category = normalizePersonalCategory({ ...existing, name: el('personalCategoryName').value, description: el('personalCategoryDescription').value, icon: el('personalCategoryIcon').value, color: el('personalCategoryColor').value });
  category.id = existing.id;
  await db.put('personal_place_categories', category);
  state.personalPlaceCategories = state.personalPlaceCategories.map((item) => item.id === category.id ? category : item);
  personalDataChanged(); closeSheets(); toast('Collection updated.');
}

async function uncategorize(placeId) {
  const place = state.personalPlaces.find((item) => item.id === placeId);
  if (!place) return;
  const updated = { ...place, categoryId: null, updatedAt: new Date().toISOString() };
  await db.put('personal_places', updated);
  state.personalPlaces = state.personalPlaces.map((item) => item.id === placeId ? updated : item);
  personalDataChanged();
  toast('Removed from this collection. The saved place was not deleted.');
}

function personalDataChanged() {
  renderPersonalPlacesPanel(); renderPersonalPlacesOnMap();
  window.dispatchEvent(new CustomEvent('personal-places-changed'));
}

export function personalPlacesExportPayload(now = new Date().toISOString()) {
  return {
    name: 'My personal places', version: '1.0', created: now,
    personal_place_categories: state.personalPlaceCategories.map(({ updatedAt, ...category }) => category),
    personal_places_data: curatedPersonalPlaces().map(({ photos, private: _private, state: _state, updatedAt, ...place }) => ({ ...place, photos: [] })),
    export_format: 'walk-wildlife-personal-places-v1'
  };
}

function exportPersonalPlaces() {
  const payload = personalPlacesExportPayload();
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'my-personal-places.walkplaces'; link.click(); URL.revokeObjectURL(url);
  toast('Personal places exported without photos.');
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
    const candidate = normalizePersonalPlace({ ...raw, categoryId: categoryMap.get(raw.categoryId || raw.category_id || raw.category) || raw.categoryId || raw.category_id || raw.category }, now);
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
    const editCategory = event.target.closest('[data-edit-personal-category]'); if (editCategory) { openCategoryEditor(editCategory.dataset.editPersonalCategory); return; }
    const remove = event.target.closest('[data-uncategorize-personal-place]'); if (remove) void uncategorize(remove.dataset.uncategorizePersonalPlace);
  });
  el('personalPlacesPanel')?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-personal-category-visible]'); if (!input) return;
    state.layerFilters.personal[input.dataset.personalCategoryVisible] = input.checked;
    personalDataChanged(); window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  });
  el('personalPlaceForm')?.addEventListener('submit', savePersonalPlace);
  el('personalPlaceCategory')?.addEventListener('change', renderNewCategoryFields);
  el('personalPlacePhotos')?.addEventListener('change', (event) => { el('personalPlacePhotoStatus').textContent = event.target.files.length ? `${event.target.files.length} photo${event.target.files.length === 1 ? '' : 's'} ready to save` : 'Optional · private on this device'; });
  el('personalCategoryForm')?.addEventListener('submit', saveCategory);
  window.addEventListener('personal-place-create-requested', (event) => openPersonalPlaceForm(event.detail || {}));
  window.addEventListener('map-viewport-changed', renderPersonalPlacesOnMap);
}
