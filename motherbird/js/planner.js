import { state } from './state.js';
import { setPlannerSelecting } from './planner-selection.js?v=20261004-planner-selection-1';
import { CITIES } from './constants.js';
import { poiTags } from './poi.js';
import { routeOnFoot } from './routing.js?v=20261005-live-route-line-2';
import { escapeHtml } from './utils.js';
import { toast } from './ui.js';
import { splitDisconnectedPaths } from './routes.js';

function selectedMinutes() { return Number(document.querySelector('input[name="walkTime"]:checked')?.value || 30); }
function selectedRouteMode() { return document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip'; }
function plannerOrigin() { return state.plannerStart || state.currentPosition || state.map?.getCenter() || CITIES[state.activeCity].center; }

function interests() {
  const pressed = [...document.querySelectorAll('[data-start-interest][aria-pressed="true"]')].map((button) => button.dataset.startInterest);
  return pressed.length ? pressed : (state.settings.favoriteCategories || []);
}

function candidateStops(origin, tags) {
  const candidates = (state.cityPois[state.activeCity] || []).filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng) && poi.category !== 'journey');
  const score = (poi) => {
    const poiTagSet = new Set(poiTags(poi));
    const interest = tags.filter((tag) => poiTagSet.has(tag)).length * 8;
    const distance = Math.hypot((poi.lat - origin.lat) * 111, (poi.lng - origin.lng) * 88);
    return interest + Number(poi.walkRelevanceScore || 0) - distance;
  };
  return candidates.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

function conceptReason(stops) {
  const tags = [...new Set(stops.flatMap(poiTags))];
  const ground = tags.includes('trail') ? 'trail and named-place ground' : tags.some((tag) => ['park', 'nature', 'wildlife'].includes(tag)) ? 'green and wildlife ground' : 'neighborhood place ground';
  return `${ground[0].toUpperCase()}${ground.slice(1)} · ${stops.length} stop${stops.length === 1 ? '' : 's'} · ${stops.map((stop) => stop.name).slice(0, 2).join(' and ')}`;
}

export function paintWalkConcept(plan = state.plannedRoute, { fit = true } = {}) {
  if (!plan || !state.map) return null;
  state.planSketchLayer?.remove();
  state.plannedRouteLine?.remove();
  state.plannedRouteLines?.forEach((line) => line.remove());
  state.planSketchLayer = L.layerGroup().addTo(state.map);
  const routePane = state.map.getPane('plannerRoutePane') || state.map.createPane('plannerRoutePane');
  routePane.style.zIndex = '720';
  routePane.style.pointerEvents = 'none';
  plan.stops.forEach((stop, index) => L.marker([stop.lat, stop.lng], { icon: L.divIcon({ className: 'sketch-stop', html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: stop.name }).bindTooltip(stop.name).addTo(state.planSketchLayer));
  const splitPaths = splitDisconnectedPaths(plan.coordinates);
  // Never let a valid routing result produce directions without a visible
  // path: if every segment is classified as discontinuous, retain the full
  // geometry as a fallback overlay.
  const routePaths = splitPaths.length
    ? splitPaths
    : ((plan.coordinates?.length || 0) > 1
      ? [plan.coordinates]
      : (state.plannerStart && state.plannerEnd ? [[
        [state.plannerStart.lat, state.plannerStart.lng],
        [state.plannerEnd.lat, state.plannerEnd.lng]
      ]] : []));
  // Use a contrasting casing so the route remains obvious over satellite,
  // OSM, and greenway basemaps instead of disappearing into dark map detail.
  const routeCasingLines = routePaths.map((coordinates) => L.polyline(coordinates, { pane: 'plannerRoutePane', color: '#123b72', weight: 11, opacity: .98, lineCap: 'round', lineJoin: 'round' }).addTo(state.map));
  state.plannedRouteLines = routePaths.map((coordinates) => L.polyline(coordinates, { pane: 'plannerRoutePane', color: '#168cff', weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(state.map));
  [...routeCasingLines, ...state.plannedRouteLines].forEach((line) => line.bringToFront());
  state.plannerRouteCasingLines = routeCasingLines;
  const restoreRouteOverlay = () => {
    [...(state.plannerRouteCasingLines || []), ...(state.plannedRouteLines || [])].forEach((line) => {
      if (!state.map.hasLayer(line)) line.addTo(state.map);
      line.bringToFront();
    });
  };
  if (!state.plannerRouteOverlayBound) {
    state.plannerRouteOverlayBound = true;
    state.map.on('moveend zoomend resize', restoreRouteOverlay);
  }
  state.plannedRouteLine = state.plannedRouteLines[0] || null;
  const layers = [...state.planSketchLayer.getLayers(), ...routeCasingLines, ...state.plannedRouteLines];
  if (fit && layers.length) {
    const bounds = L.featureGroup(layers).getBounds();
    // The directions card occupies the middle/lower map on mobile. Reserve
    // that space so the route is fitted into the visible map area instead of
    // being hidden beneath the card.
    if (bounds.isValid()) state.map.fitBounds(bounds, { paddingTopLeft: [42, 42], paddingBottomRight: [42, 300], maxZoom: 16 });
  }
  window.dispatchEvent(new CustomEvent('walk-sketch-painted', { detail: plan }));
  return plan;
}

export async function generateTimeBasedPlan({ stops: seededStops = null, title = null, reason = null, journeyId = null } = {}) {
  const minutes = selectedMinutes();
  const routeMode = selectedRouteMode();
  const center = plannerOrigin();
  const needsMapDestination = ['round-trip', 'point-to-point'].includes(routeMode);
  if (needsMapDestination && !state.plannerEnd) {
    setPlannerSelecting('End');
    toast('Tap a destination on the map to make this a point-to-point walk.');
    return null;
  }
  const count = minutes <= 20 ? 2 : minutes >= 60 ? 4 : 3;
  const selectedStops = (state.plannerStops || []).map((point, index) => ({ name: `Stop ${index + 1}`, ...point }));
  const stops = needsMapDestination
    ? [...selectedStops, { name: 'Selected destination', lat: state.plannerEnd.lat, lng: state.plannerEnd.lng }]
    : (seededStops?.length ? seededStops : candidateStops(center, interests()).slice(0, count));
  if (!stops.length) {
    toast('No candidate places nearby to sketch a walk. Try panning the map or picking an area with places.');
    return null;
  }
  // Point-to-point mode must honor the explicit Start endpoint selected by
  // the user. Falling back to the map center is appropriate only when no
  // start was chosen (for legacy/generated plans).
  const routeOrigin = routeMode === 'point-to-point' ? (state.plannerStart || center) : center;
  const points = ['round-trip', 'auto-round-trip'].includes(routeMode) ? [center, ...stops, center] : [routeOrigin, ...stops];
  const routed = await routeOnFoot(points, { city: state.activeCity, profile: 'ordinary_walking_beta' }).catch(() => ({ ok: false, status: 'GRAPH_VERSION_UNAVAILABLE' }));
  if (new URLSearchParams(globalThis.location?.search || '').has('diagnose')) {
    globalThis.__lastRouteResult = routed;
    document.body.dataset.routeStatus = routed.ok ? 'ROUTE_FOUND' : (routed.status || 'unknown');
    document.body.dataset.routeFailure = routed.failure?.reason || routed.failure?.message || '';
  }
  if (!routed.ok && new URLSearchParams(globalThis.location?.search || '').has('diagnose')) {
    toast(`Route ${routed.status}: ${routed.failure?.reason || routed.failure?.message || 'no diagnostic available'}`);
  }
  if (!routed.ok && routeMode === 'point-to-point') {
    state.plannerEnd = null;
    setPlannerSelecting('End');
    const detail = routed.failure?.reason || routed.failure?.message || routed.status;
    toast(new URLSearchParams(globalThis.location?.search || '').has('diagnose')
      ? `Route ${routed.status}: ${detail}`
      : 'That destination could not be connected. Tap the map again to choose another point.');
  }
  const plan = {
    id: `concept-${Date.now()}`, title: title || `${CITIES[state.activeCity]?.name || 'Local'} ${minutes}-minute sketch`,
    reason: reason || conceptReason(stops), city: state.activeCity, routeMode, estimatedDurationMinutes: minutes,
    stops, coordinates: routed.ok ? routed.coordinates : [], journeyId,
    ...(routed.ok ? { distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), graphVersion: routed.graphVersion, cellId: routed.cellId, cellRelease: routed.cellRelease, edgeIds: routed.edgeIds, instructions: routed.instructions } : { graphStatus: routed.status || 'GRAPH_VERSION_UNAVAILABLE' })
  };
  state.plannedRoute = plan; state.planOptions = [plan];
  paintWalkConcept(plan);
  return plan;
}

export function choosePlan(id) { return state.planOptions.find((plan) => plan.id === id) || state.plannedRoute; }
export function changePlan() { state.plannedRoute = null; state.planSketchLayer?.remove(); state.plannedRouteLine?.remove(); state.plannedRouteLines?.forEach((line) => line.remove()); state.plannerRouteCasingLines?.forEach((line) => line.remove()); state.plannedRouteLines = []; state.plannerRouteCasingLines = []; }
export function togglePlanVisibility() { /* A single painted sketch replaces graph alternatives. */ }
export function setPlanningMode(active) { state.planningMode = Boolean(active); }
export function lockSelectedPlanOnMap() { return paintWalkConcept(state.plannedRoute, { fit: false }); }
export function previewTimeBasedPlan(options) { return paintWalkConcept(state.plannedRoute, options); }
export function renderPlanPreview() { return state.plannedRoute; }
export async function draftWalkFromText(text) {
  const query = String(text || '').trim().toLocaleLowerCase();
  const stops = (state.cityPois[state.activeCity] || []).filter((poi) => query && poi.name.toLocaleLowerCase().includes(query)).slice(0, 4);
  return generateTimeBasedPlan({ stops, title: query ? `Walk to ${stops[0]?.name || query}` : null });
}

export function routeEvidence(route) { return { restrooms: (route.stops || []).filter((stop) => poiTags(stop).includes('restrooms')).length, drinkingWater: (route.stops || []).filter((stop) => stop.drinkingWater).length }; }
export function routeExplanation(route) { return [route.reason || 'Installed pack places and the selected time']; }
export function objectiveCost(route) { return Number(route.distanceMeters || 0); }
