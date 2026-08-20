import { CITIES } from './constants.js';
import db from './storage.js';
import { state } from './state.js';
import { reindexSpatialData, upgradeSpatialDataFromPackage } from './spatial-index.js';
import { el, escapeHtml } from './utils.js';
import { toast } from './ui.js';

const PASTELS = ['#f2b8b5', '#f6d28f', '#c7dca7', '#a9d7d0', '#b9c7e8', '#d7b9df', '#efc6a8'];
let controlsReady = false;

export function initNeighborhoodDiscovery() {
  if (controlsReady) return;
  controlsReady = true;
  el('resetNeighborhoodsButton')?.addEventListener('click', resetNeighborhoodDiscoveries);
}

export async function loadNeighborhoodsForCity(cityId = state.activeCity) {
  state.neighborhoodLayer?.remove(); state.neighborhoodLayer = null; state.neighborhoodData = null; state.discoveredNeighborhoodIds = new Set();
  el('neighborhoodDiscoveryPanel')?.classList.add('hidden');
  const file = CITIES[cityId]?.neighborhoodFile;
  const spatialIndexPath = CITIES[cityId]?.spatialIndexPath || `./regions/${cityId}/spatial`;
  if (!file || !state.map) { await upgradeSpatialDataFromPackage(cityId, state.cityPois[cityId] || [], null, spatialIndexPath); return null; }
  try {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Boundary package returned ${response.status}`);
    const data = await response.json();
    validateNeighborhoodPackage(data, cityId);
    const saved = await db.all('neighborhood_discoveries');
    state.discoveredNeighborhoodIds = new Set(saved.filter((item) => item.cityId === cityId).map((item) => item.neighborhoodId));
    state.neighborhoodData = data;
    state.neighborhoodLayer = L.geoJSON(data, { style: neighborhoodStyle, onEachFeature }).addTo(state.map);
    state.neighborhoodLayer.bringToBack();
    const spatial = await upgradeSpatialDataFromPackage(cityId, state.cityPois[cityId] || [], data, spatialIndexPath);
    if (spatial.fallbackReason && !/returned 404/.test(spatial.fallbackReason)) console.warn('Static spatial package unavailable:', spatial.fallbackReason);
    updateDiscoveryPanel();
    return data;
  } catch (error) {
    console.warn('Neighborhood package unavailable:', error);
    reindexSpatialData(cityId, state.cityPois[cityId] || [], null);
    return null;
  }
}

export async function markNeighborhoodDiscovered(neighborhoodId) {
  if (!neighborhoodId || state.discoveredNeighborhoodIds.has(neighborhoodId)) return;
  state.discoveredNeighborhoodIds.add(neighborhoodId);
  await db.put('neighborhood_discoveries', { id: `${state.activeCity}:${neighborhoodId}`, cityId: state.activeCity, neighborhoodId, discoveredAt: new Date().toISOString() });
  restyleNeighborhoods(); updateDiscoveryPanel();
  const feature = state.neighborhoodData?.features.find((item) => featureId(item) === neighborhoodId);
  toast(`${feature?.properties?.name || 'Neighborhood'} discovered.`);
}

export async function resetNeighborhoodDiscoveries() {
  const records = await db.all('neighborhood_discoveries');
  await Promise.all(records.filter((item) => item.cityId === state.activeCity).map((item) => db.remove('neighborhood_discoveries', item.id)));
  state.discoveredNeighborhoodIds.clear(); restyleNeighborhoods(); updateDiscoveryPanel(); toast('Neighborhood discoveries reset for testing.');
}

export function pastelForNeighborhood(neighborhoodId) {
  const hash = [...String(neighborhoodId)].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 0);
  return PASTELS[hash % PASTELS.length];
}

function validateNeighborhoodPackage(data, cityId) {
  if (data?.type !== 'FeatureCollection' || data.metadata?.regionId !== 'washington-dc' || data.metadata?.layerRole !== 'neighborhood_boundaries' || !data.features?.length) throw new Error(`Invalid neighborhood package for ${cityId}`);
  data.features.forEach((feature) => { if (!featureId(feature) || !feature.properties?.name || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) throw new Error('Neighborhood package contains an invalid feature.'); });
}
function featureId(feature) { return String(feature?.properties?.id || feature?.id || ''); }
function neighborhoodStyle(feature) { const discovered = state.discoveredNeighborhoodIds.has(featureId(feature)); return { color: discovered ? pastelForNeighborhood(featureId(feature)) : '#64736b', weight: discovered ? 2 : 1.1, opacity: discovered ? 0.9 : 0.42, fillColor: discovered ? pastelForNeighborhood(featureId(feature)) : '#dfe5dd', fillOpacity: discovered ? 0.46 : 0.055 }; }
function onEachFeature(feature, layer) {
  const id = featureId(feature); const name = feature.properties.name;
  layer.bindTooltip(name, { sticky: true, className: 'neighborhood-tooltip' });
  layer.bindPopup(() => `<div class="neighborhood-popup"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(feature.properties.NBH_NAMES || 'DC neighborhood cluster')}</small>${state.discoveredNeighborhoodIds.has(id) ? '<span>Discovered</span>' : `<button type="button" class="discover-neighborhood-button" data-neighborhood-id="${escapeHtml(id)}">Mark discovered</button>`}</div>`);
  layer.on('popupopen', (event) => event.popup.getElement()?.querySelector('[data-neighborhood-id]')?.addEventListener('click', () => { void markNeighborhoodDiscovered(id); layer.closePopup(); }));
}
function restyleNeighborhoods() { state.neighborhoodLayer?.eachLayer((layer) => layer.setStyle?.(neighborhoodStyle(layer.feature))); }
function updateDiscoveryPanel() {
  const panel = el('neighborhoodDiscoveryPanel'); if (!panel || !state.neighborhoodData) return;
  panel.classList.remove('hidden'); el('neighborhoodDiscoveryCount').textContent = `${state.discoveredNeighborhoodIds.size} of ${state.neighborhoodData.features.length} discovered`;
  const attribution = state.neighborhoodData.metadata?.attribution; el('neighborhoodSource').textContent = attribution ? `Boundaries: ${attribution}` : 'Producer boundary package';
}
