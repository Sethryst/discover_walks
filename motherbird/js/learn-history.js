import { state } from './state.js';
import { CITIES } from './constants.js';
import { escapeHtml } from './utils.js';
import { distanceMeters } from './geo.js';

export const LEARN_SPLITS_URL = './data/virginia-pack-splits.json';
export const LEARN_VIEWS = Object.freeze(['discover', 'history']);

let splitsCache = null;
let learnView = 'discover';

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
  return {
    visited: seen.length,
    remaining: remaining.length,
    total,
    remainingRatio: total ? remaining.length / total : 1
  };
}

export function sortSitesByDistance(sites, point) {
  if (!point || !Number.isFinite(Number(point.lat))) return [...sites];
  return [...sites].sort((left, right) => distanceMeters(point, left) - distanceMeters(point, right));
}

export function virginiaPacks(cities = CITIES) {
  return Object.entries(cities)
    .filter(([, city]) => city?.state === 'VA')
    .map(([id, city]) => ({ id, name: city.name, center: city.center }));
}

export function rectangleFromBbox(bbox) {
  if (!bbox || !['west', 'south', 'east', 'north'].every((key) => Number.isFinite(bbox[key]))) return null;
  return [
    [bbox.south, bbox.west],
    [bbox.south, bbox.east],
    [bbox.north, bbox.east],
    [bbox.north, bbox.west]
  ];
}

export function fillForRemaining(ratio) {
  const value = Math.min(1, Math.max(0, Number(ratio) || 0));
  return `rgba(45, 114, 89, ${0.08 + value * 0.22})`;
}

export async function loadVirginiaSplits() {
  if (splitsCache) return splitsCache;
  try {
    const response = await fetch(LEARN_SPLITS_URL);
    splitsCache = response.ok ? await response.json() : { packs: [] };
  } catch {
    splitsCache = { packs: [] };
  }
  return splitsCache;
}

export function paintVirginiaSplits({ map, leaflet, packs, activeId, progress }) {
  state.learnBoundsLayer?.remove();
  state.learnBoundsLayer = null;
  if (!map || !leaflet) return null;
  const layer = leaflet.layerGroup();
  for (const pack of packs || []) {
    const corners = rectangleFromBbox(pack.bbox);
    if (!corners) continue;
    const active = pack.id === activeId;
    const ratio = active ? progress?.remainingRatio ?? 1 : 1;
    leaflet.polygon(corners, {
      color: active ? '#2d7259' : '#8aa39a',
      weight: active ? 2 : 1,
      fillColor: active ? fillForRemaining(ratio) : 'rgba(138, 163, 154, 0.08)',
      fillOpacity: 1,
      interactive: false
    }).addTo(layer);
  }
  layer.addTo(map);
  state.learnBoundsLayer = layer;
  return layer;
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
  return `<article class="guide-card learn-site" data-learn-place="${escapeHtml(String(poi.id))}">
    <label class="learn-check"><input type="checkbox" data-learn-check="${escapeHtml(String(poi.id))}" ${visited ? 'checked' : ''} /><span>${escapeHtml(kind)}</span></label>
    <h3>${escapeHtml(name)}</h3>
    <div class="learn-site-actions">
      <button class="secondary-button" type="button" data-learn-walk="${escapeHtml(String(poi.id))}">Walk there</button>
    </div>
  </article>`;
}

export function learnHistoryHtml({ progress, view, sites }) {
  const viewName = LEARN_VIEWS.includes(view) ? view : 'discover';
  const empty = viewName === 'history'
    ? 'No checked history sites in this pack yet.'
    : 'No unchecked history sites remain in this pack.';
  const list = sites.length ? sites.map((poi) => siteCard(poi, viewName === 'history')).join('') : `<p class="empty-state">${empty}</p>`;
  return `<section class="learn-history">
    <p class="learn-progress">${progress.visited} of ${progress.total} history sites checked. ${progress.remaining} still to discover.</p>
    <div class="learn-views" role="tablist">
      <button type="button" data-learn-view="discover" class="${viewName === 'discover' ? 'active' : ''}">Still to discover</button>
      <button type="button" data-learn-view="history" class="${viewName === 'history' ? 'active' : ''}">History</button>
    </div>
    ${list}
  </section>`;
}

export async function renderLearnHistory(target, point) {
  const pois = state.cityPois[state.activeCity] || [];
  const progress = packProgress(pois, state.profile);
  const split = splitHistorySites(pois, state.profile);
  const raw = learnView === 'history' ? split.seen : split.remaining;
  const sites = sortSitesByDistance(raw, point).slice(0, 40);
  target.innerHTML = learnHistoryHtml({ progress, view: learnView, sites });
  const catalog = await loadVirginiaSplits();
  paintVirginiaSplits({
    map: state.map,
    leaflet: globalThis.L,
    packs: catalog.packs || [],
    activeId: state.activeCity,
    progress
  });
}

export function setLearnView(view) {
  learnView = LEARN_VIEWS.includes(view) ? view : 'discover';
  return learnView;
}

export function currentLearnView() {
  return learnView;
}

export function isCheckedSite(poi, profile) {
  return idsFromProfile(profile).has(String(poi?.id || ''));
}
