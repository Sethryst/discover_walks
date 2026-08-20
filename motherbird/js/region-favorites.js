import { el, escapeHtml } from './utils.js';

let treePromise;
const loadTree = () => treePromise ||= fetch('./data/favorites_tree.v1.json').then((response) => response.ok ? response.json() : null).catch(() => null);

export async function renderFavoriteRegions(settings) {
  const select = el('favoriteRegionSelect'); const chips = el('favoriteRegionChips');
  if (!select || !chips) return;
  const tree = await loadTree();
  if (!tree) { select.innerHTML = '<option>Virginia regions unavailable</option>'; return; }
  const localities = tree.localities || []; const towns = tree.towns || [];
  const parentNames = new Map(localities.map((item) => [item.id, item.name]));
  const items = [...localities, ...towns.map((item) => ({ ...item, name_full: `${item.name_full} · ${parentNames.get(item.parent_id) || 'Virginia'}` }))];
  select.innerHTML = `<option value="">Choose a county, city, or town</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name_full)}</option>`).join('')}`;
  const favorites = new Set(settings.favoriteRegionIds || []); const byId = new Map(items.map((item) => [item.id, item]));
  chips.innerHTML = [...favorites].map((id) => byId.get(id)).filter(Boolean).map((item) => `<button class="poi-chip active" type="button" data-favorite-region="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name_full)}">${escapeHtml(item.name)} ×</button>`).join('') || '<small class="save-indicator">No favorite regions yet.</small>';
}

export async function toggleFavoriteRegion(settings, id) {
  const tree = await loadTree(); const allowed = new Set([...(tree?.localities || []), ...(tree?.towns || [])].map((item) => item.id));
  if (!allowed.has(id)) return false;
  const favorites = new Set(settings.favoriteRegionIds || []);
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  settings.favoriteRegionIds = [...favorites];
  return true;
}
