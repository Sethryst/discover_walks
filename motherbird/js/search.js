import { state } from './state.js';
import { isVisiblePoi, searchPois, searchOsm } from './poi.js';
import { escapeHtml } from './utils.js';
import { mergeExplorePois } from './learn-explore.js';

void mergeExplorePois();

export const SEARCH_HINT = 'Place, trail, tree, marker, or wildlife';

const WILDLIFE_WORDS = {
  heron: ['wildlife', 'wetland', 'marsh', 'pond', 'creek', 'river'],
  egret: ['wildlife', 'wetland', 'marsh'],
  duck: ['wildlife', 'pond', 'lake', 'water'],
  deer: ['wildlife', 'woods', 'park'],
  fox: ['wildlife', 'woods'],
  beaver: ['wildlife', 'creek', 'stream'],
  turtle: ['wildlife', 'pond', 'wetland'],
  hawk: ['wildlife', 'woods'],
  owl: ['wildlife', 'woods'],
  eagle: ['wildlife', 'river', 'reservoir'],
  bird: ['wildlife', 'park'],
  wildlife: ['wildlife', 'nature', 'refuge'],
  oak: ['nature', 'park', 'tree'],
  elm: ['nature', 'park', 'tree'],
  tree: ['nature', 'park'],
  champion: ['nature', 'park'],
  marker: ['history', 'history_marker'],
  historic: ['history', 'history_marker'],
  benchmark: ['history', 'history_landmark'],
  survey: ['history', 'history_landmark'],
  creek: ['water', 'trail', 'nature'],
  stream: ['water', 'trail']
};

function blob(poi) {
  return `${poi.name || ''} ${poi.category || ''} ${poi.type || ''} ${poi.subcategory || ''} ${(poi.tags || []).join(' ')}`.toLowerCase();
}

export function localSearchHits(query, observations = []) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  void mergeExplorePois();
  const hits = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.id || seen.has(String(item.id))) return;
    seen.add(String(item.id));
    hits.push(item);
  };
  searchPois(query).forEach((poi) => add({ ...poi, searchKind: 'Place' }));
  const pois = (state.cityPois[state.activeCity] || []).filter(isVisiblePoi);
  const aliases = WILDLIFE_WORDS[q] || Object.entries(WILDLIFE_WORDS).filter(([word]) => q.includes(word)).flatMap(([, tags]) => tags);
  for (const poi of pois) {
    const text = blob(poi);
    const tagHit = aliases.some((tag) => text.includes(tag));
    const trailHit = /trail|path|loop|greenway|boardwalk/.test(text) && (q.includes('trail') || text.includes(q));
    const wildHit = /wildlife|refuge|marsh|pond/.test(text) && (aliases.length || /wildlife|refuge|heron|marsh|pond/.test(q));
    const markHit = /survey|benchmark|marker|champion|oak|elm|tree/.test(q) && /history|nature|marker|tree|survey/.test(text);
    if (text.includes(q) || tagHit || trailHit || wildHit || markHit) {
      add({ ...poi, searchKind: /marker|survey|benchmark/.test(q) ? 'Marker' : /tree|oak|elm|champion/.test(q) ? 'Tree' : wildHit || aliases.length ? 'Wildlife' : trailHit ? 'Trail' : 'Place' });
    }
  }
  for (const edge of state.trailSegments?.[state.activeCity] || []) {
    const name = String(edge.name || '');
    if (name && name.toLowerCase().includes(q)) {
      const point = edge.coordinates?.[0] || edge;
      add({ id: `trail:${edge.id || name}`, name, lat: Number(point.lat ?? point[0]), lng: Number(point.lng ?? point[1]), searchKind: 'Trail' });
    }
  }
  for (const item of observations) {
    const text = `${item.species || ''} ${item.title || ''} ${item.note || ''}`.toLowerCase();
    if (text.includes(q)) add({ id: `obs:${item.id}`, name: item.species || item.title || 'Wildlife note', lat: Number(item.location?.lat ?? item.lat), lng: Number(item.location?.lng ?? item.lng), searchKind: 'Wildlife' });
  }
  return hits.filter((hit) => Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lng))).slice(0, 12);
}

export function searchRowHtml(hit) {
  return `<button type="button" data-search-poi="${escapeHtml(String(hit.id))}" data-search-lat="${hit.lat}" data-search-lng="${hit.lng}"><small>${escapeHtml(hit.searchKind || 'Place')}</small>${escapeHtml(hit.name || 'Named place')}</button>`;
}

export function emptySearchHtml(query, pending) {
  if (pending) return `<p class="map-search-empty">No pack match for “${escapeHtml(query)}”. Searching the wider map.</p>`;
  return `<p class="map-search-empty">No place, trail, tree, marker, or wildlife name matched “${escapeHtml(query)}”.</p>`;
}

export async function widenSearch(query) {
  try {
    const remote = await searchOsm(query);
    return remote.map((poi) => ({ ...poi, searchKind: 'Map' }));
  } catch {
    return [];
  }
}
