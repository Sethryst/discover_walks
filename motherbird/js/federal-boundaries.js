import { state } from './state.js';
import { FederalRegionLoader } from './federal-region-loader.js';
import { debounce } from './utils.js';
import { FederalRegionProgress } from './federal-region-progress.js';

export const FEDERAL_BOUNDARY_TYPES = Object.freeze({
  state: { label: 'State', fill: '#a9c9e8', border: '#527a9e', pane: 'federal-state-pane', zIndex: 310 },
  county: { label: 'County', fill: '#b7ddc2', border: '#638a70', pane: 'federal-county-pane', zIndex: 320 },
  congressional_district: { label: 'Congressional District', fill: '#d1b8e4', border: '#806295', pane: 'federal-congress-pane', zIndex: 330 }
});

export function visibilityAtZoom(enabled, zoom) {
  return {
    state: Boolean(enabled.state),
    county: Boolean(enabled.county && zoom >= 6),
    congressional_district: Boolean(enabled.congressional_district)
  };
}

export function federalBoundaryStyle(type, opacityPercent = 22) {
  const palette = FEDERAL_BOUNDARY_TYPES[type];
  if (!palette) throw new Error(`Unknown federal boundary type ${type}.`);
  const fillOpacity = Math.min(1, Math.max(0.15, Number(opacityPercent) / 100));
  return { color: palette.border, fillColor: palette.fill, fillOpacity, opacity: Math.min(0.9, fillOpacity + 0.42), weight: type === 'state' ? 1.35 : 1.05 };
}

export function resolveFederalRegionLabel(features, point, { enabled = {}, zoom = 6, neighborhoods } = {}) {
  return resolveFederalRegion(features, point, { enabled, zoom, neighborhoods }).label;
}

export function resolveFederalRegion(features, point, { enabled = {}, zoom = 6, neighborhoods } = {}) {
  const neighborhood = (neighborhoods?.features || []).find((feature) => pointInGeometry(point, feature.geometry));
  if (neighborhood) return { label: `${neighborhood.properties?.name || 'DC neighborhood'}, DC`, regionId: null };
  const visible = visibilityAtZoom(enabled, zoom);
  const containing = (type) => visible[type] ? features.find((feature) => feature.properties?.boundary_type === type && pointInGeometry(point, feature.geometry)) : null;
  const district = containing('congressional_district');
  const stateFeature = containing('state') || features.find((feature) => feature.properties?.boundary_type === 'state' && pointInGeometry(point, feature.geometry));
  const stateName = stateFeature?.properties?.name || 'This state';
  if (district) return { label: districtLabel(stateName, district.properties?.district), regionId: district.properties?.boundary_id };
  const county = containing('county');
  if (county) return { label: `${county.properties?.name || 'County'}, ${stateName}`, regionId: county.properties?.boundary_id };
  return { label: stateFeature?.properties?.name || 'Federal boundaries', regionId: stateFeature?.properties?.boundary_id };
}

export class FederalBoundaryOverlay {
  constructor(map, {
    loader = new FederalRegionLoader('./federal-regions'),
    leaflet = globalThis.L,
    defaultOpacity = 22
  } = {}) {
    if (!map || !leaflet) throw new Error('Federal boundaries require Leaflet and an initialized map.');
    this.map = map;
    this.loader = loader;
    this.L = leaflet;
    this.opacity = defaultOpacity;
    this.enabled = { state: true, county: true, congressional_district: true };
    this.features = [];
    this.layers = new Map();
    this.progress = new FederalRegionProgress('./federal-regions');
    this.requestSequence = 0;
    this.progressSequence = 0;
    this.disposed = false;
    this.refreshSettled = debounce(() => { void this.refresh(); }, 140);
  }

  async start() {
    this.createPanes();
    this.createLayers();
    this.createControl();
    this.map.on('moveend zoomend', this.refreshSettled);
    globalThis.window?.addEventListener('neighborhood-boundaries-updated', this.refreshSettled);
    globalThis.window?.addEventListener('poi-visit-state-changed', this.refreshSettled);
    await this.refresh();
    return this;
  }

  async refresh() {
    if (this.disposed) return;
    this.syncZoomState();
    const sequence = ++this.requestSequence;
    const bounds = this.map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    try {
      const collection = await this.loader.loadViewport({ bbox, zoom: this.map.getZoom() });
      if (this.disposed || sequence !== this.requestSequence) return;
      this.features = collection.features;
      this.renderFeatures();
      this.control?.classList.remove('federal-boundary-control--error');
    } catch (error) {
      if (sequence !== this.requestSequence) return;
      console.warn('Federal boundary overlay unavailable:', error.message);
      this.currentLabel.textContent = 'Boundaries unavailable'; this.progressLabel.textContent = '';
      this.control?.classList.add('federal-boundary-control--error');
    }
  }

  renderFeatures() {
    for (const [type, layer] of this.layers) {
      layer.clearLayers();
      layer.addData({ type: 'FeatureCollection', features: this.features.filter((feature) => feature.properties?.boundary_type === type) });
    }
    this.syncLayerVisibility();
    this.updateCurrentLabel();
  }

  syncLayerVisibility() {
    const visible = visibilityAtZoom(this.enabled, this.map.getZoom());
    for (const [type, layer] of this.layers) {
      layer.setStyle(() => federalBoundaryStyle(type, this.opacity));
      if (visible[type] && !this.map.hasLayer(layer)) layer.addTo(this.map);
      if (!visible[type] && this.map.hasLayer(layer)) layer.removeFrom(this.map);
    }
    this.updateCurrentLabel();
  }

  syncZoomState() {
    if (!this.countyInput) return;
    const available = this.map.getZoom() >= 6;
    this.countyInput.disabled = !available;
    this.countyRow.classList.toggle('federal-boundary-option--zoom-hidden', !available);
    this.countyHint.textContent = available ? '' : 'Zoom 6+';
    this.syncLayerVisibility();
  }

  updateCurrentLabel() {
    if (!this.currentLabel) return;
    const center = this.map.getCenter();
    const region = resolveFederalRegion(this.features, [center.lng, center.lat], {
      enabled: this.enabled,
      zoom: this.map.getZoom(),
      neighborhoods: state.neighborhoodData
    });
    this.currentLabel.textContent = region.label;
    void this.updateProgress(region);
  }

  async updateProgress(region) { const sequence = ++this.progressSequence; const progress = await this.progress.forRegion(region.regionId, state.profile); if (this.disposed || sequence !== this.progressSequence || !this.progressLabel) return; this.progressLabel.textContent = progress ? `${progress.visited} of ${progress.total} POIs visited` : ''; }

  createPanes() {
    for (const definition of Object.values(FEDERAL_BOUNDARY_TYPES)) {
      const pane = this.map.getPane(definition.pane) || this.map.createPane(definition.pane);
      pane.style.zIndex = String(definition.zIndex);
      pane.style.pointerEvents = 'none';
    }
  }

  createLayers() {
    for (const [type, definition] of Object.entries(FEDERAL_BOUNDARY_TYPES)) {
      this.layers.set(type, this.L.geoJSON([], { pane: definition.pane, interactive: false, style: () => federalBoundaryStyle(type, this.opacity) }));
    }
  }

  createControl() {
    const control = this.L.control({ position: 'topleft' });
    control.onAdd = () => {
      const container = this.L.DomUtil.create('section', 'leaflet-control federal-boundary-control');
      container.setAttribute('aria-label', 'Federal boundary layers');
      container.innerHTML = '<div class="federal-region-status" aria-live="polite"><div class="federal-current-region"></div><div class="federal-region-progress"></div></div><button class="federal-boundary-disclosure" type="button" aria-expanded="false"><span aria-hidden="true">▱</span> Boundaries</button><div class="federal-boundary-panel hidden"><div class="federal-boundary-heading"><strong>Boundary layers</strong><button type="button" aria-label="Collapse boundary controls">×</button></div><div class="federal-boundary-options"></div><label class="federal-opacity"><span>Fill opacity <output>22%</output></span><input type="range" min="15" max="100" value="22" step="1" /></label></div>';
      this.L.DomEvent.disableClickPropagation(container);
      this.L.DomEvent.disableScrollPropagation(container);
      this.control = container;
      this.currentLabel = container.querySelector('.federal-current-region');
      this.progressLabel = container.querySelector('.federal-region-progress');
      this.panel = container.querySelector('.federal-boundary-panel');
      this.disclosure = container.querySelector('.federal-boundary-disclosure');
      this.disclosure.addEventListener('click', () => this.setExpanded(this.panel.classList.contains('hidden')));
      container.querySelector('.federal-boundary-heading button').addEventListener('click', () => this.setExpanded(false));
      const options = container.querySelector('.federal-boundary-options');
      for (const [type, definition] of Object.entries(FEDERAL_BOUNDARY_TYPES)) {
        const label = document.createElement('label');
        label.className = 'federal-boundary-option';
        label.innerHTML = `<input type="checkbox" checked /><i style="--boundary-swatch:${definition.fill}"></i><span>${definition.label}</span><small></small>`;
        const input = label.querySelector('input');
        input.addEventListener('change', () => { this.enabled[type] = input.checked; this.syncLayerVisibility(); });
        options.append(label);
        if (type === 'county') { this.countyInput = input; this.countyRow = label; this.countyHint = label.querySelector('small'); }
      }
      const range = container.querySelector('.federal-opacity input');
      const output = container.querySelector('.federal-opacity output');
      range.value = String(this.opacity); output.textContent = `${this.opacity}%`;
      range.addEventListener('input', () => { this.opacity = Number(range.value); output.textContent = `${this.opacity}%`; this.syncLayerVisibility(); });
      return container;
    };
    control.addTo(this.map);
    this.leafletControl = control;
    document.querySelector('.map-panel')?.classList.add('federal-boundaries-ready');
  }

  setExpanded(expanded) {
    this.panel.classList.toggle('hidden', !expanded);
    this.disclosure.classList.toggle('hidden', expanded);
    this.disclosure.setAttribute('aria-expanded', String(expanded));
    this.control.classList.toggle('federal-boundary-control--expanded', expanded);
  }

  destroy() {
    this.disposed = true;
    this.map.off('moveend zoomend', this.refreshSettled);
    globalThis.window?.removeEventListener('neighborhood-boundaries-updated', this.refreshSettled);
    globalThis.window?.removeEventListener('poi-visit-state-changed', this.refreshSettled);
    for (const layer of this.layers.values()) layer.removeFrom(this.map);
    this.leafletControl?.remove();
  }
}

export async function initFederalBoundaries(options = {}) {
  state.federalBoundaryOverlay?.destroy();
  state.federalBoundaryOverlay = new FederalBoundaryOverlay(state.map, options);
  try { await state.federalBoundaryOverlay.start(); }
  catch (error) { console.warn('Federal boundary controls could not start:', error.message); }
  return state.federalBoundaryOverlay;
}

function districtLabel(stateName, districtCode) {
  if (districtCode === '00') return `${stateName} at-large district`;
  if (districtCode === '98') return `${stateName} delegate district`;
  const district = Number(districtCode);
  return Number.isInteger(district) ? `${stateName}’s ${ordinal(district)} District` : `${stateName} congressional district`;
}

function ordinal(value) {
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
  return `${value}${suffix}`;
}

function pointInGeometry([x, y], geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(([outer, ...holes]) => pointInRing(x, y, outer) && !holes.some((ring) => pointInRing(x, y, ring)));
}

function pointInRing(x, y, ring = []) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index]; const [xj, yj] = ring[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}
