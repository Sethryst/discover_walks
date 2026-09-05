import { state } from './state.js';
import db from './storage.js';
import { el, escapeHtml } from './utils.js';
import { closeSheets, toast } from './ui.js';
import { curatedPersonalPlaces, normalizePersonalCategory, openPersonalPlaceForm } from './personal-places.js';

const DEFAULT_COLOR = '#E8740F';
let openMapsFolderId = null;

export function categoryParentId(category, categories = []) {
  const ids = new Set(categories.map((item) => item.id));
  return ids.has(category?.parentId) ? category.parentId : null;
}

export function childMapFolders(parentId, categories = []) {
  return categories.filter((category) => categoryParentId(category, categories) === parentId);
}

export function placesInMapFolder(folderId, places = []) {
  return (places || []).filter((place) => (place.categoryId || place.category_id) === folderId);
}

export function countMapFolderPlaces(folderId, categories = [], places = []) {
  const direct = placesInMapFolder(folderId, places).length;
  return childMapFolders(folderId, categories).reduce((sum, child) => sum + countMapFolderPlaces(child.id, categories, places), direct);
}

function mapsFolderTile(category, categories, places) {
  const count = countMapFolderPlaces(category.id, categories, places);
  return `<button type="button" class="guide-card learn-group maps-folder" data-maps-folder="${escapeHtml(category.id)}" style="--learn-color:${escapeHtml(category.color || DEFAULT_COLOR)}"><span class="learn-art" aria-hidden="true"></span><h3>${escapeHtml(category.name)}</h3><small>${count} place${count === 1 ? '' : 's'}</small></button>`;
}

function mapsPlaceCard(place, color) {
  const status = place.publicMarkerId ? `Posted ${place.visibility}` : 'Private on this device';
  return `<article class="guide-card learn-entry maps-place" data-focus-personal-place="${escapeHtml(place.id)}" style="--learn-color:${escapeHtml(color || DEFAULT_COLOR)}"><small>${escapeHtml(status)}</small><h3>${escapeHtml(place.name || 'Saved place')}</h3><div class="learn-site-actions"><button class="secondary-button" type="button" data-edit-personal-place="${escapeHtml(place.id)}">Edit</button></div></article>`;
}

function mapsFolderForm(parentId) {
  return `<form class="maps-folder-form" data-maps-new-folder="${escapeHtml(parentId || '')}"><input name="folderName" maxlength="60" placeholder="New folder name" aria-label="New folder name" /><button class="secondary-button" type="submit">Add folder</button></form>`;
}

export function mapsLibraryHtml({ categories = [], places = [], openFolderId = null, visibleFilters = {} } = {}) {
  const folder = categories.find((category) => category.id === openFolderId) || null;
  const parentId = folder ? folder.id : null;
  const folders = childMapFolders(parentId, categories);
  const here = placesInMapFolder(parentId, places);
  const folderTiles = folders.length ? `<div class="learn-groups">${folders.map((item) => mapsFolderTile(item, categories, places)).join('')}</div>` : '';
  const placeCards = here.length
    ? here.map((place) => mapsPlaceCard(place, folder?.color)).join('')
    : (folder ? '<p class="empty-state">No places in this folder yet.</p>' : '');
  if (!folder) {
    return `<section class="learn-history learn-library maps-library"><h3 class="learn-kicker">Folders</h3>${folderTiles || '<p class="learn-progress">Add a folder to group your places.</p>'}<h3 class="learn-kicker">Places</h3>${placeCards || '<p class="empty-state">No unfiled places.</p>'}${mapsFolderForm('')}<div class="maps-library-actions"><button class="primary-button" type="button" data-maps-add-place="">Add location</button></div></section>`;
  }
  const visible = visibleFilters[folder.id] !== false;
  return `<section class="learn-history learn-library maps-library"><button type="button" class="secondary-button" data-maps-back="1">Back</button><h3 class="learn-kicker">${escapeHtml(folder.name)}</h3><label class="personal-map-toggle"><input type="checkbox" data-personal-category-visible="${escapeHtml(folder.id)}" ${visible ? 'checked' : ''} /> Show this folder on the map</label>${folderTiles ? `<h3 class="learn-kicker">Folders</h3>${folderTiles}` : ''}<h3 class="learn-kicker">Places</h3>${placeCards}${mapsFolderForm(folder.id)}<div class="maps-library-actions"><button class="primary-button" type="button" data-add-to-personal-category="${escapeHtml(folder.id)}">Add location</button></div></section>`;
}

function visibleMapPlaces() {
  return curatedPersonalPlaces().filter((place) => !place.advancedOnly || state.settings.showAdvancedPlaces);
}

export function renderMapsLibrary(target = el('fieldGuideList')) {
  if (!target) return;
  if (openMapsFolderId && !state.personalPlaceCategories.some((category) => category.id === openMapsFolderId)) openMapsFolderId = null;
  target.innerHTML = mapsLibraryHtml({
    categories: state.personalPlaceCategories,
    places: visibleMapPlaces(),
    openFolderId: openMapsFolderId,
    visibleFilters: state.layerFilters.personal
  });
}

function uniqueFolderId(base) {
  let id = base;
  let suffix = 2;
  const ids = new Set(state.personalPlaceCategories.map((category) => category.id));
  while (ids.has(id)) { id = `${base}-${suffix}`; suffix += 1; }
  return id;
}

async function addMapsFolder(form) {
  const name = String(form.querySelector('[name="folderName"]')?.value || '').trim();
  if (!name) { toast('Name the folder first.'); return; }
  const parentId = form.dataset.mapsNewFolder || null;
  const parent = state.personalPlaceCategories.find((category) => category.id === parentId);
  const category = normalizePersonalCategory({
    name,
    parentId: parent?.id || null,
    color: parent?.color || DEFAULT_COLOR,
    icon: parent?.icon || 'map-pin'
  });
  category.id = uniqueFolderId(category.id);
  await db.put('personal_place_categories', category);
  state.personalPlaceCategories.push(category);
  state.layerFilters.personal[category.id] = true;
  openMapsFolderId = category.id;
  renderMapsLibrary();
  toast(`${category.name} folder added.`);
}

function focusPersonalPlace(placeId) {
  const place = curatedPersonalPlaces().find((item) => item.id === placeId);
  if (!place?.location) return;
  closeSheets();
  state.map?.flyTo([place.location.lat, place.location.lng], Math.max(state.map.getZoom?.() || 14, 16));
}

export function initMapsFolders() {
  if (initMapsFolders.bound) return;
  initMapsFolders.bound = true;
  document.addEventListener('click', (event) => {
    if (state.fieldGuideTab !== 'maps') return;
    if (event.target.closest('[data-maps-add-place]')) { openPersonalPlaceForm(); return; }
    const add = event.target.closest('[data-add-to-personal-category]');
    if (add) { openPersonalPlaceForm({ categoryId: add.dataset.addToPersonalCategory }); return; }
    const edit = event.target.closest('[data-edit-personal-place]');
    if (edit) { openPersonalPlaceForm({ editId: edit.dataset.editPersonalPlace }); return; }
    const back = event.target.closest('[data-maps-back]');
    if (back) {
      const current = state.personalPlaceCategories.find((category) => category.id === openMapsFolderId);
      openMapsFolderId = current ? categoryParentId(current, state.personalPlaceCategories) : null;
      renderMapsLibrary();
      return;
    }
    const folder = event.target.closest('[data-maps-folder]');
    if (folder) { openMapsFolderId = folder.dataset.mapsFolder; renderMapsLibrary(); return; }
    const focus = event.target.closest('[data-focus-personal-place]');
    if (focus && !event.target.closest('button')) focusPersonalPlace(focus.dataset.focusPersonalPlace);
  });
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-maps-new-folder]');
    if (!form) return;
    event.preventDefault();
    void addMapsFolder(form);
  });
  document.addEventListener('change', (event) => {
    const input = event.target.closest('#fieldGuideList [data-personal-category-visible]');
    if (!input) return;
    state.layerFilters.personal[input.dataset.personalCategoryVisible] = input.checked;
    window.dispatchEvent(new CustomEvent('layer-state-dirty'));
    renderMapsLibrary();
  });
  window.addEventListener('personal-places-changed', () => {
    if (state.fieldGuideTab === 'maps') renderMapsLibrary();
  });
}
