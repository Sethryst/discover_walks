import { state } from './state.js';
import { CITIES } from './constants.js';
import { escapeHtml } from './utils.js';
import { distanceMeters } from './geo.js';

export const LEARN_INDEX_URL = './data/learn/index.json';
export const LEARN_SPLITS_URL = './data/learn/history/pack-splits.json';
export const LEARN_SPLITS_FALLBACK_URL = './data/virginia-pack-splits.json';
export const LEARN_VIEWS = Object.freeze(['discover', 'history']);
export const LEARN_FOLDERS = Object.freeze([
  { id: 'discover', label: 'Still to discover', children: ['sites', 'watersheds', 'streams'] },
  { id: 'history', label: 'History', children: ['sites', 'eras', 'splits'] }
]);

let splitsCache = null;
let watershedCache = null;
let battlefieldCache = null;
let lensCache = null;
let learnView = 'discover';
let learnScreen = 'home';
let activeWatershedId = null;
let activeEraId = null;
let activeYear = null;
let activeBattleId = null;
let activeLensItemId = null;

function idsFromProfile(profile) {
  return new Set(profile?.visitedPoiIds || []);
}

export function historyTags(poi) {
  const tags = [...(poi?.tags || [])];
  if (poi?.category) tags.push(poi.category);
  if (poi?.type) tags.push(poi.type);
  if (poi?.subcategory && /histor/i.test(poi.subcategory)) tags.push('history');
  return tags.map(String);
}

export function isHistorySite(poi) {
  if (!poi) return false;
  const tags = historyTags(poi);
  if (tags.some((tag) => tag === 'history' || tag.startsWith('history_'))) return true;
  const text = `${poi.name || ''} ${poi.category || ''} ${poi.type || ''}`;
  return /museum|historic|heritage|battlefield|monument/i.test(text);
}

export function isMuseumSite(poi) {
  const tags = historyTags(poi);
  if (tags.includes('history_museum')) return true;
  return /museum/i.test(String(poi?.name || ''));
}

export function historySites(pois = []) {
  return (pois || []).filter((poi) => poi && Number.isFinite(Number(poi.lat)) && Number.isFinite(Number(poi.lng)) && isHistorySite(poi));
}

export function splitHistorySites(pois, profile) {
  const visited = idsFromProfile(profile);
  const sites = historySites(pois);
  const seen = [];
  const remaining = [];
  for (const poi of sites) {
    if (visited.has(String(poi.id))) seen.push(poi);
    else remaining.push(poi);
  }
  return { seen, remaining, total: sites.length };
}

export function packProgress(pois, profile) {
  const { seen, remaining, total } = splitHistorySites(pois, profile);
  return { visited: seen.length, remaining: remaining.length, total, remainingRatio: total ? remaining.length / total : 1 };
}

export function sortSitesByDistance(sites, point) {
  if (!point || !Number.isFinite(Number(point.lat))) return [...sites];
  return [...sites].sort((left, right) => distanceMeters(point, left) - distanceMeters(point, right));
}

export function rectangleFromBbox(bbox) {
  if (!bbox || !['west', 'south', 'east', 'north'].every((key) => Number.isFinite(bbox[key]))) return null;
  return [[bbox.south, bbox.west], [bbox.south, bbox.east], [bbox.north, bbox.east], [bbox.north, bbox.west]];
}

export function fillForRemaining(ratio) {
  const value = Math.min(1, Math.max(0, Number(ratio) || 0));
  return `rgba(45, 114, 89, ${0.08 + value * 0.22})`;
}

export async function loadVirginiaSplits() {
  if (splitsCache) return splitsCache;
  try {
    const response = await fetch(LEARN_SPLITS_URL);
    if (response.ok) splitsCache = await response.json();
    else {
      const fallback = await fetch(LEARN_SPLITS_FALLBACK_URL);
      splitsCache = fallback.ok ? await fallback.json() : { packs: [] };
    }
  } catch { splitsCache = { packs: [] }; }
  return splitsCache;
}

export function paintVirginiaSplits({ map, leaflet, packs, activeId, progress }) {
  state.learnBoundsLayer?.remove(); state.learnBoundsLayer = null;
  if (!map || !leaflet) return null;
  const layer = leaflet.layerGroup();
  for (const pack of packs || []) {
    const corners = rectangleFromBbox(pack.bbox);
    if (!corners) continue;
    const active = pack.id === activeId;
    const ratio = active ? progress?.remainingRatio ?? 1 : 1;
    leaflet.polygon(corners, { color: active ? '#2d7259' : '#8aa39a', weight: active ? 2 : 1, fillColor: active ? fillForRemaining(ratio) : 'rgba(138, 163, 154, 0.08)', fillOpacity: 1, interactive: false }).addTo(layer);
  }
  layer.addTo(map); state.learnBoundsLayer = layer; return layer;
}

function siteKind(poi) {
  if (isMuseumSite(poi)) return 'Museum';
  const tags = historyTags(poi);
  if (tags.includes('history_monument')) return 'Monument';
  if (tags.includes('history_cemetery')) return 'Cemetery';
  if (tags.includes('history_landmark')) return 'Landmark';
  return 'History';
}

function siteCard(poi, visited) {
  const name = poi.name || 'Unnamed place';
  const kind = siteKind(poi);
  return `<article class="guide-card learn-site" data-learn-place="${escapeHtml(String(poi.id))}"><label class="learn-check"><input type="checkbox" data-learn-check="${escapeHtml(String(poi.id))}" ${visited ? 'checked' : ''} /><span>${escapeHtml(kind)}</span></label><h3>${escapeHtml(name)}</h3><div class="learn-site-actions"><button class="secondary-button" type="button" data-learn-walk="${escapeHtml(String(poi.id))}">Walk there</button></div></article>`;
}

function childSlot(folderId, child) {
  if (child.status === 'live') return '';
  return `<article class="learn-slot" data-learn-slot="${escapeHtml(folderId)}:${escapeHtml(child.id)}"><small>NEXT</small><h3>${escapeHtml(child.label)}</h3><p>This layer waits in ${escapeHtml(child.file || child.id)}.</p></article>`;
}

export function learnFolderHtml(folder, sites) {
  const open = folder.id === 'discover' ? 'open' : '';
  const empty = folder.id === 'history' ? 'No checked history sites in this pack yet.' : 'No unchecked history sites remain in this pack.';
  const visited = folder.id === 'history';
  const list = sites.length ? sites.map((poi) => siteCard(poi, visited)).join('') : `<p class="empty-state">${empty}</p>`;
  const slots = (folder.children || []).filter((child) => child.id !== 'sites' && child.status !== 'live').map((child) => childSlot(folder.id, child)).join('');
  return `<details class="learn-folder" data-learn-folder="${escapeHtml(folder.id)}" ${open}><summary>${escapeHtml(folder.label)}</summary><div class="learn-folder-body">${list}${slots}</div></details>`;
}

export function learnHistoryHtml({ progress, folders, remaining = [], seen = [] }) {
  const discover = folders?.find((folder) => folder.id === 'discover') || { id: 'discover', label: 'Still to discover', children: [] };
  const history = folders?.find((folder) => folder.id === 'history') || { id: 'history', label: 'History', children: [] };
  return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-home="1">Back</button><p class="learn-progress">${progress.visited} of ${progress.total} history sites checked. ${progress.remaining} still to discover.</p>${learnFolderHtml(discover, remaining)}${learnFolderHtml(history, seen)}</section>`;
}

export function setLearnView(view) { learnView = LEARN_VIEWS.includes(view) ? view : 'discover'; return learnView; }
export function currentLearnView() { return learnView; }
export function isCheckedSite(poi, profile) { return idsFromProfile(profile).has(String(poi?.id || '')); }
export function setLearnScreen(screen) {
  learnScreen = ['home', 'history', 'watersheds', 'battlefields', 'names', 'protected', 'wildlife'].includes(screen) ? screen : 'home';
  if (screen !== 'battlefields') { activeEraId = null; activeYear = null; activeBattleId = null; }
  if (!['names', 'protected', 'wildlife'].includes(screen)) activeLensItemId = null;
  return learnScreen;
}
export function setLearnSheetMin(on) { document.getElementById('backpackSheet')?.classList.toggle('learn-min', !!on); }
export function currentLearnScreen() { return learnScreen; }
export function setActiveWatershed(id) { activeWatershedId = id || null; return activeWatershedId; }
export function setActiveLensItem(id) { activeLensItemId = id || null; return activeLensItemId; }
export function setBattlefieldEra(id) { activeEraId = id || null; activeYear = null; activeBattleId = null; return activeEraId; }
export function setBattlefieldYear(year) { activeYear = year == null ? null : Number(year); activeBattleId = null; return activeYear; }
export function setBattlefieldSite(id) { activeBattleId = id || null; return activeBattleId; }
export function stepBattlefieldBack() {
  if (activeBattleId) { activeBattleId = null; return 'year'; }
  if (activeYear != null) { activeYear = null; return 'era'; }
  if (activeEraId) { activeEraId = null; return 'eras'; }
  return 'home';
}

export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const hit = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}
export function pointInFeature(lng, lat, feature) {
  const geom = feature?.geometry; if (!geom) return false;
  if (geom.type === 'Polygon') return pointInRing(lng, lat, geom.coordinates[0] || []);
  if (geom.type === 'MultiPolygon') return (geom.coordinates || []).some((poly) => pointInRing(lng, lat, poly[0] || []));
  return false;
}
export function isWalkNatureSite(poi) {
  const tags = historyTags(poi).map((tag) => tag.toLowerCase());
  const text = `${poi?.name || ''} ${poi?.category || ''}`;
  return tags.some((tag) => ['park', 'nature', 'trail', 'wildlife', 'water', 'garden'].includes(tag)) || /park|trail|stream|creek|woods|garden|wildlife/i.test(text);
}
export function placesInWatershed(pois, feature) {
  return (pois || []).filter((poi) => Number.isFinite(Number(poi.lat)) && Number.isFinite(Number(poi.lng)) && pointInFeature(Number(poi.lng), Number(poi.lat), feature));
}
export function learnHomeHtml() {
  return `<section class="learn-history"><button type="button" class="guide-card learn-entry" data-learn-open="history"><h3>Track VA history sites</h3></button><button type="button" class="guide-card learn-entry" data-learn-open="watersheds"><h3>View watersheds</h3></button><button type="button" class="guide-card learn-entry" data-learn-open="battlefields"><h3>View historic battlefields</h3></button><button type="button" class="guide-card learn-entry" data-learn-open="names"><h3>Name this landscape</h3></button><button type="button" class="guide-card learn-entry" data-learn-open="protected"><h3>Who protects this land</h3></button><button type="button" class="guide-card learn-entry" data-learn-open="wildlife"><h3>Wildlife recorded here</h3></button></section>`;
}
export function watershedListHtml(features, selectedId, places) {
  const selected = (features || []).find((feature) => feature.properties?.id === selectedId);
  if (selected) {
    const item = selected.properties || {};
    const walk = (places || [])[0];
    const walkHtml = walk ? `<button class="secondary-button" type="button" data-learn-walk="${escapeHtml(String(walk.id))}">Walk inside</button>` : '';
    return `<section class="learn-history learn-region"><button type="button" class="secondary-button" data-learn-watershed-back="1">Select another</button><h3>${escapeHtml(item.name || 'Watershed')}</h3><p>${escapeHtml(item.protect || '')}</p>${walkHtml}</section>`;
  }
  const list = (features || []).map((feature) => {
    const item = feature.properties || {};
    return `<button type="button" class="guide-card" data-learn-watershed="${escapeHtml(item.id)}"><h3>${escapeHtml(item.name)}</h3></button>`;
  }).join('');
  return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-home="1">Back</button>${list}</section>`;
}
export async function loadWatersheds() {
  if (watershedCache) return watershedCache;
  try {
    const response = await fetch('./data/learn/discover/watersheds.json');
    watershedCache = response.ok ? await response.json() : { features: [] };
  } catch { watershedCache = { features: [] }; }
  return watershedCache;
}
export function paintWatersheds({ map, leaflet, features, selectedId }) {
  state.learnWatershedLayer?.remove(); state.learnWatershedLayer = null;
  if (!map || !leaflet) return null;
  const shown = selectedId ? (features || []).filter((feature) => feature.properties?.id === selectedId) : (features || []);
  const layer = leaflet.layerGroup();
  let selectedLayer = null;
  for (const feature of shown) {
    const active = feature.properties?.id === selectedId;
    const painted = leaflet.geoJSON(feature, { style: { color: active ? '#1d4f7a' : '#4f7f9a', weight: active ? 2 : 1, fillColor: active ? 'rgba(45,114,89,0.28)' : 'rgba(79,127,154,0.12)', fillOpacity: 1 } }).addTo(layer);
    if (active) selectedLayer = painted;
  }
  layer.addTo(map); state.learnWatershedLayer = layer;
  if (selectedLayer?.getBounds && map.fitBounds) map.fitBounds(selectedLayer.getBounds().pad(0.08), { maxZoom: 13 });
  return layer;
}
export async function loadBattlefields() {
  if (battlefieldCache) return battlefieldCache;
  try {
    const response = await fetch('./data/learn/history/battlefields.json');
    battlefieldCache = response.ok ? await response.json() : { eras: [] };
  } catch { battlefieldCache = { eras: [] }; }
  return battlefieldCache;
}
export function battlefieldHtml({ eras, era, year, battle }) {
  if (battle) {
    return `<section class="learn-history learn-region"><button type="button" class="secondary-button" data-learn-battle-back="1">Select another</button><h3>${escapeHtml(battle.name)}</h3><p>${escapeHtml(String(year?.year || ''))}. ${escapeHtml(battle.note || '')}</p></section>`;
  }
  if (year) {
    const list = (year.battles || []).map((item) => `<button type="button" class="guide-card" data-learn-battle="${escapeHtml(item.id)}"><h3>${escapeHtml(item.name)}</h3></button>`).join('');
    return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-battle-back="1">Back</button>${list}</section>`;
  }
  if (era) {
    const list = (era.years || []).map((item) => `<button type="button" class="guide-card" data-learn-year="${escapeHtml(String(item.year))}"><h3>${escapeHtml(item.label || String(item.year))}</h3></button>`).join('');
    return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-battle-back="1">Back</button>${list}</section>`;
  }
  const list = (eras || []).map((item) => `<button type="button" class="guide-card" data-learn-era="${escapeHtml(item.id)}"><h3>${escapeHtml(item.label)}</h3></button>`).join('');
  return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-home="1">Back</button>${list}</section>`;
}
export function paintBattlefield({ map, leaflet, battle }) {
  state.learnBattlefieldLayer?.remove(); state.learnBattlefieldLayer = null;
  if (!map || !leaflet || !battle || !Number.isFinite(Number(battle.lat))) return null;
  const layer = leaflet.layerGroup();
  leaflet.circleMarker([battle.lat, battle.lng], { radius: 10, color: '#7a2d1d', weight: 2, fillColor: 'rgba(122,45,29,0.28)', fillOpacity: 1 }).addTo(layer);
  layer.addTo(map); state.learnBattlefieldLayer = layer;
  map.setView([battle.lat, battle.lng], 12);
  return layer;
}
export async function loadLearnLenses() {
  if (lensCache) return lensCache;
  try {
    const response = await fetch('./data/learn/discover/lenses.json');
    lensCache = response.ok ? await response.json() : { lenses: [] };
  } catch { lensCache = { lenses: [] }; }
  return lensCache;
}
function countWildlifeNotes() {
  return (state.cityPois[state.activeCity] || []).filter((poi) => /wildlife|wetland|marsh|refuge/.test(`${poi.category || ''} ${(poi.tags || []).join(' ')}`.toLowerCase())).length;
}
export function lensHtml(lens, selected, seenWildlife = 0) {
  if (!lens) return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-home="1">Back</button><p class="empty-state">This source is not loaded.</p></section>`;
  if (selected) {
    const extra = lens.id === 'wildlife' ? `<p>${seenWildlife} wildlife sites sit in this pack.</p>` : '';
    const manager = selected.manager ? `<p>${escapeHtml(selected.manager)}</p>` : '';
    return `<section class="learn-history learn-region"><button type="button" class="secondary-button" data-learn-lens-back="1">Select another</button><h3>${escapeHtml(selected.name)}</h3><p>${escapeHtml(selected.kind || '')}. ${escapeHtml(selected.note || '')}</p>${manager}${extra}<a href="${escapeHtml(lens.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(lens.sourceName)}</a></section>`;
  }
  const lead = lens.id === 'wildlife' ? `<p class="learn-progress">You are in the ${escapeHtml(lens.region || 'Piedmont')}. ${seenWildlife} wildlife sites sit in this pack.</p>` : `<p class="learn-progress">${escapeHtml(lens.question || '')}</p>`;
  const list = (lens.items || []).map((item) => `<button type="button" class="guide-card" data-learn-lens-item="${escapeHtml(item.id)}"><h3>${escapeHtml(item.name)}</h3></button>`).join('');
  return `<section class="learn-history"><button type="button" class="secondary-button" data-learn-home="1">Back</button>${lead}${list}</section>`;
}
export function paintLensItem({ map, leaflet, lens, selected }) {
  state.learnLensLayer?.remove(); state.learnLensLayer = null;
  if (!map || !leaflet) return null;
  const items = selected ? [selected] : (lens?.items || []);
  const layer = leaflet.layerGroup();
  const points = [];
  for (const item of items) {
    if (!Number.isFinite(Number(item.lat))) continue;
    points.push([item.lat, item.lng]);
    leaflet.circleMarker([item.lat, item.lng], { radius: selected ? 10 : 6, color: selected ? '#7a2d1d' : '#2d7259', weight: 2, fillColor: selected ? 'rgba(122,45,29,0.28)' : 'rgba(45,114,89,0.22)', fillOpacity: 1 }).addTo(layer);
  }
  layer.addTo(map); state.learnLensLayer = layer;
  if (selected) map.setView([selected.lat, selected.lng], 13);
  else if (points.length > 1 && map.fitBounds) map.fitBounds(points, { padding: [24, 24], maxZoom: 12 });
  return layer;
}
export async function renderLearnHistory(target, point) {
  if (learnScreen === 'home') {
    setLearnSheetMin(false);
    target.innerHTML = learnHomeHtml();
    state.learnBoundsLayer?.remove(); state.learnBoundsLayer = null;
    return;
  }
  const pois = state.cityPois[state.activeCity] || [];
  if (learnScreen === 'watersheds') {
    const catalog = await loadWatersheds();
    const features = catalog.features || [];
    const selected = features.find((feature) => feature.properties?.id === activeWatershedId) || null;
    setLearnSheetMin(!!selected);
    const inside = selected ? placesInWatershed(pois, selected).filter(isWalkNatureSite) : [];
    target.innerHTML = watershedListHtml(features, activeWatershedId, sortSitesByDistance(inside, point));
    paintWatersheds({ map: state.map, leaflet: globalThis.L, features, selectedId: activeWatershedId });
    return;
  }
  if (learnScreen === 'battlefields') {
    const catalog = await loadBattlefields();
    const eras = catalog.eras || [];
    const era = eras.find((item) => item.id === activeEraId) || null;
    const year = era?.years?.find((item) => Number(item.year) === Number(activeYear)) || null;
    const battle = year?.battles?.find((item) => item.id === activeBattleId) || null;
    setLearnSheetMin(!!battle);
    target.innerHTML = battlefieldHtml({ eras, era, year, battle });
    paintBattlefield({ map: state.map, leaflet: globalThis.L, battle });
    return;
  }
  if (['names', 'protected', 'wildlife'].includes(learnScreen)) {
    const catalog = await loadLearnLenses();
    const lens = (catalog.lenses || []).find((item) => item.id === learnScreen) || null;
    const selected = (lens?.items || []).find((item) => item.id === activeLensItemId) || null;
    setLearnSheetMin(!!selected);
    target.innerHTML = lensHtml(lens, selected, countWildlifeNotes());
    paintLensItem({ map: state.map, leaflet: globalThis.L, lens, selected });
    return;
  }
  setLearnSheetMin(false);
  const progress = packProgress(pois, state.profile);
  const split = splitHistorySites(pois, state.profile);
  let folders = LEARN_FOLDERS.map((folder) => ({ ...folder, children: folder.children.map((id) => ({ id, label: id, status: 'live' })) }));
  try {
    const index = await fetch(LEARN_INDEX_URL).then((response) => response.ok ? response.json() : null);
    if (index?.folders?.length) folders = index.folders;
  } catch {}
  target.innerHTML = learnHistoryHtml({ progress, folders, remaining: sortSitesByDistance(split.remaining, point).slice(0, 40), seen: sortSitesByDistance(split.seen, point).slice(0, 40) });
  const catalog = await loadVirginiaSplits();
  paintVirginiaSplits({ map: state.map, leaflet: globalThis.L, packs: catalog.packs || [], activeId: state.activeCity, progress });
}
