import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { setLearnSheetMin } from './learn-history.js';

export const CHANGE_NEWS_URL = './data/learn/news/change-news.json';
export const EAST_POTOMAC_URL = './data/learn/news/east-potomac.json';

let changeCache = null;
let storyCache = null;

export async function loadChangeNews() {
  if (changeCache) return changeCache;
  try {
    const response = await fetch(CHANGE_NEWS_URL);
    changeCache = response.ok ? await response.json() : { items: [] };
  } catch {
    changeCache = { items: [] };
  }
  return changeCache;
}

export async function loadEastPotomacStory() {
  if (storyCache) return storyCache;
  try {
    const response = await fetch(EAST_POTOMAC_URL);
    storyCache = response.ok ? await response.json() : null;
  } catch {
    storyCache = null;
  }
  return storyCache;
}

export function changeNewsForPack(items = [], packId) {
  const aliases = packId === 'dc' ? ['dc', 'washington-dc'] : [packId];
  return (items || []).filter((item) => !item.packIds?.length || item.packIds.some((id) => aliases.includes(id)));
}

export function changeNotice(item) {
  if (!item?.title || !item.officialUrl) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  return {
    ...item,
    kind: 'Change',
    artifact_type: 'place_change',
    officialUrl: item.officialUrl,
    locationLabel: item.title,
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  };
}

export function storyCardHtml(item, viewId) {
  const views = item?.views || [];
  const current = views.find((view) => view.id === viewId) || views[0];
  const tabs = views.map((view) => `<button type="button" class="secondary-button ${view.id === current?.id ? 'on' : ''}" data-news-view="${escapeHtml(view.id)}">${escapeHtml(view.label)}</button>`).join('');
  return `<section class="learn-history learn-region learn-change"><button type="button" class="secondary-button" data-change-news-close="1">Close</button><h3>${escapeHtml(item.title || 'Place change')}</h3><div class="learn-views">${tabs}</div><p>${escapeHtml(current?.text || item.now || '')}</p><a href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceName || 'Official source')}</a></section>`;
}

function openStoryCard(item, viewId) {
  const list = document.getElementById('fieldGuideList');
  const sheet = document.getElementById('backpackSheet');
  if (!list || !sheet) return;
  sheet.classList.remove('hidden');
  setLearnSheetMin(true);
  list.innerHTML = storyCardHtml(item, viewId);
  list.querySelector('[data-change-news-close]')?.addEventListener('click', () => {
    setLearnSheetMin(false);
    sheet.classList.add('hidden');
  });
  list.querySelectorAll('[data-news-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = (item.views || []).find((entry) => entry.id === button.dataset.newsView);
      if (view && state.map) state.map.setView([view.lat, view.lng], 15);
      openStoryCard(item, button.dataset.newsView);
    });
  });
}

export function paintChangeStory(item) {
  state.learnChangeLayer?.remove();
  state.learnChangeLayer = null;
  const map = state.map;
  const leaflet = globalThis.L;
  if (!map || !leaflet || !item) return null;
  const color = item.color || '#b85c7a';
  const layer = leaflet.layerGroup();
  const ring = item.ring || [];
  if (ring.length > 2) {
    leaflet.polygon(ring, { color, weight: 3, fillColor: color, fillOpacity: 0.22 }).on('click', () => openStoryCard(item, 'place')).addTo(layer);
    leaflet.polyline(ring, { color, weight: 4, opacity: 0.95 }).addTo(layer);
  }
  for (const view of item.views || []) {
    leaflet.circleMarker([view.lat, view.lng], { radius: 9, color, weight: 2, fillColor: '#fff', fillOpacity: 1 }).on('click', () => {
      map.setView([view.lat, view.lng], 16);
      openStoryCard(item, view.id);
    }).bindTooltip(view.label).addTo(layer);
  }
  layer.addTo(map);
  state.learnChangeLayer = layer;
  if (ring.length > 2 && map.fitBounds) map.fitBounds(ring, { padding: [28, 28], maxZoom: 14 });
  return layer;
}

export async function showChangeOnMap(item) {
  const story = item?.id === 'east-potomac-golf-2026' ? { ...item, ...(await loadEastPotomacStory()) } : item;
  paintChangeStory(story);
  openStoryCard(story, 'now');
}

export async function syncNewsStory() {
  if (state.layerLights?.news === false) {
    state.learnChangeLayer?.remove();
    state.learnChangeLayer = null;
    return;
  }
  const pack = await loadChangeNews();
  const items = changeNewsForPack(pack.items || [], state.activeCity);
  const east = items.find((item) => item.id === 'east-potomac-golf-2026');
  if (!east) return;
  const story = { ...east, ...(await loadEastPotomacStory()) };
  paintChangeStory(story);
}
