import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { setLearnSheetMin, setLearnScreen } from './learn-history.js';

export const CHANGE_NEWS_URL = './data/learn/news/change-news.json';

let changeCache = null;

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

export function changeNewsForPack(items = [], packId) {
  return (items || []).filter((item) => !item.packIds?.length || item.packIds.includes(packId));
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

export function changeCardHtml(item) {
  if (!item) return '';
  return `<section class="learn-history learn-region learn-change">
    <button type="button" class="secondary-button" data-change-news-close="1">Close</button>
    <h3>${escapeHtml(item.title)}</h3>
    <p><strong>Now.</strong> ${escapeHtml(item.now || '')}</p>
    <p><strong>Place.</strong> ${escapeHtml(item.place || '')}</p>
    <p><strong>Change.</strong> ${escapeHtml(item.change || '')}</p>
    <a href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceName || 'Official source')}</a>
    <button type="button" class="secondary-button" data-learn-open="protected">Who protects this land</button>
    <button type="button" class="secondary-button" data-learn-open="names">Name this landscape</button>
  </section>`;
}

export function paintChangeArea(item) {
  state.learnChangeLayer?.remove();
  state.learnChangeLayer = null;
  const map = state.map;
  const leaflet = globalThis.L;
  if (!map || !leaflet || !item?.location) return null;
  const layer = leaflet.layerGroup();
  const box = item.bbox;
  if (box && ['west', 'south', 'east', 'north'].every((key) => Number.isFinite(box[key]))) {
    leaflet.rectangle([[box.south, box.west], [box.north, box.east]], {
      color: '#8b3a4a',
      weight: 2,
      fillColor: 'rgba(139,58,74,0.18)',
      fillOpacity: 1
    }).addTo(layer);
    map.fitBounds([[box.south, box.west], [box.north, box.east]], { padding: [24, 24], maxZoom: 14 });
  } else {
    leaflet.circleMarker([item.location.lat, item.location.lng], {
      radius: 12,
      color: '#8b3a4a',
      weight: 2,
      fillColor: 'rgba(139,58,74,0.22)',
      fillOpacity: 1
    }).addTo(layer);
    map.setView([item.location.lat, item.location.lng], 14);
  }
  layer.addTo(map);
  state.learnChangeLayer = layer;
  return layer;
}

export async function showChangeOnMap(item) {
  if (!item) return;
  paintChangeArea(item);
  const list = document.getElementById('fieldGuideList');
  const sheet = document.getElementById('backpackSheet');
  if (!list || !sheet) return;
  sheet.classList.remove('hidden');
  setLearnSheetMin(true);
  setLearnScreen('home');
  list.innerHTML = changeCardHtml(item);
  list.querySelector('[data-change-news-close]')?.addEventListener('click', () => {
    setLearnSheetMin(false);
    sheet.classList.add('hidden');
  });
}
