import { state } from './state.js';
import { setPlannerSelecting } from './planner-selection.js?v=20261004-planner-selection-1';
import { CITIES } from './constants.js';
import { poiTags } from './poi.js';
import { routeOnFoot, routeFailureMessage } from './routing.js?v=20261007-ambient-routing-1';
import { escapeHtml } from './utils.js';
import { toast } from './ui.js';
import { splitDisconnectedPaths } from './routes.js';
import { buildAmbientExplanation, generateAmbientOptions, installAmbientLearningListener, readAmbientMemory } from './ambient-mip.js?v=20261007-ambient-12';

function selectedMinutes() { return Number(document.querySelector('input[name="walkTime"]:checked')?.value || 30); }
function selectedRouteMode() { return document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip'; }
function plannerOrigin() { return state.plannerStart || state.currentPosition || state.lastPosition || state.map?.getCenter() || CITIES[state.activeCity].center; }
let generation = 0;
installAmbientLearningListener();

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

function normalizeStop(stop, index) {
  const location = stop?.location || {};
  const lat = Number.isFinite(Number(stop?.lat)) ? Number(stop.lat) : Number(location.lat);
  const lng = Number.isFinite(Number(stop?.lng)) ? Number(stop.lng) : Number(location.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { ...stop, name: stop.name || `Stop ${index + 1}`, lat, lng }
    : null;
}

function distanceBetween(a, b) {
  const latScale = 111;
  const lngScale = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180) * 111;
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
}

function orderAutoRoundTripStops(stops, origin) {
  const remaining = [...stops];
  const ordered = [];
  let cursor = origin;
  while (remaining.length) {
    let bestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (distanceBetween(cursor, remaining[index]) < distanceBetween(cursor, remaining[bestIndex])) bestIndex = index;
    }
    cursor = remaining.splice(bestIndex, 1)[0];
    ordered.push(cursor);
  }
  return ordered;
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
  const requestGeneration = ++generation;
  const minutes = selectedMinutes();
  const routeMode = selectedRouteMode();
  const center = plannerOrigin();
  const needsMapDestination = ['round-trip', 'point-to-point'].includes(routeMode);
  if (routeMode === 'point-to-point' && !state.plannerStart && !state.currentPosition) {
    setPlannerSelecting('Start');
    toast('Choose a starting point on the map before choosing a destination.');
    return null;
  }
  if (needsMapDestination && !state.plannerEnd) {
    setPlannerSelecting('End');
    toast('Tap a destination on the map to make this a point-to-point walk.');
    return null;
  }
  const count = minutes <= 20 ? 2 : minutes >= 60 ? 4 : 3;
  const selectedStops = (state.plannerStops || []).map((point, index) => normalizeStop({ name: `Stop ${index + 1}`, ...point }, index)).filter(Boolean);
  const rawStops = needsMapDestination
    ? [...selectedStops, { name: 'Selected destination', lat: state.plannerEnd.lat, lng: state.plannerEnd.lng }]
    : (seededStops?.length ? seededStops : candidateStops(center, interests()).slice(0, count)).map(normalizeStop).filter(Boolean);
  const stops = routeMode === 'auto-round-trip' ? orderAutoRoundTripStops(rawStops, center) : rawStops;
  if (!stops.length) {
    toast('No candidate places nearby to sketch a walk. Try panning the map or picking an area with places.');
    return null;
  }
  // Point-to-point mode must honor the explicit Start endpoint selected by
  // the user. Falling back to the map center is appropriate only when no
  // start was chosen (for legacy/generated plans).
  const routeOrigin = routeMode === 'point-to-point' ? (state.plannerStart || center) : center;
  if (routeMode === 'point-to-point' && state.plannerEnd && !seededStops?.length) {
    const localMemory = readAmbientMemory();
    const nearby = candidateStops(routeOrigin, []).slice(0, 6).filter((stop) => distanceBetween(routeOrigin, stop) < 8);
    const discoveryStops = selectedStops.length ? selectedStops : nearby.filter((stop) => poiTags(stop).some((tag) => ['trail', 'park', 'nature', 'history', 'culture', 'water'].includes(tag))).slice(0, 2);
    const quietStops = nearby.filter((stop) => poiTags(stop).some((tag) => ['park', 'trail', 'nature', 'quiet'].includes(tag))).slice(0, 2);
    const ambient = await generateAmbientOptions({ origin: routeOrigin, destination: state.plannerEnd, routeOnFoot, context: { availableMinutes: minutes, destination: state.plannerEnd, currentPaceMps: state.walk?.paceMps, routeHistoryCount: state.walks?.length || 0, rememberedPlaceCount: state.personalPlaces?.length || 0, avoidEdges: state.routingConstraints?.avoidEdges || state.avoidEdges || [], graphVersion: state.routingConstraints?.graphVersion || null, cellRelease: state.routingConstraints?.cellRelease || null }, memory: localMemory, discoveryStops, quietStops });
    if (requestGeneration !== generation) return null;
    if (ambient.routes.length) {
      const optionRoutes = ambient.primary ? [ambient.primary, ...(ambient.alternatives || [])] : ambient.routes;
      const plans = optionRoutes.slice(0, 3).map((routed, index) => ({
        id: routed.id, title: index === 0 ? (title || 'A good walk from here') : (routed.archetype === 'discovery' ? 'More to notice' : 'Quieter where mapped'),
        reason: buildAmbientExplanation(routed),
        city: state.activeCity, routeMode, estimatedDurationMinutes: Math.round(Number(routed.durationSeconds || 0) / 60),
        stops: routed.stops || [{ name: 'Selected destination', lat: state.plannerEnd.lat, lng: state.plannerEnd.lng }], coordinates: routed.coordinates,
        distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), graphStatus: null, graphVersion: routed.graphVersion,
        cellId: routed.cellId, cellRelease: routed.cellRelease, edgeIds: routed.edgeIds, avoidEdges: routed.avoidEdges || [], instructions: routed.instructions, destination: state.plannerEnd,
        archetype: routed.archetype, profile: routed.profile || 'ordinary_walking_beta', facts: routed.facts, ambientTraits: routed.ambientTraits || [], ambientIntention: ambient.intention
      }));
      state.planOptions = plans; state.plannedRoute = ambient.primary ? plans.find((plan) => plan.id === ambient.primary.id) || plans[0] : plans[0];
      paintWalkConcept(state.plannedRoute);
      window.dispatchEvent(new CustomEvent('ambient-routes-ready', { detail: { options: plans, intention: ambient.intention } }));
      return state.plannedRoute;
    }
  }
  const points = ['round-trip', 'auto-round-trip'].includes(routeMode) ? [center, ...stops, center] : [routeOrigin, ...stops];
  const routed = await routeOnFoot(points, { city: state.activeCity, profile: 'ordinary_walking_beta' }).catch((error) => ({ ok: false, status: 'ROUTING_WORKER_ERROR', failure: { message: error?.message || 'Offline routing failed.' } }));
  if (requestGeneration !== generation) return null;
  if (new URLSearchParams(globalThis.location?.search || '').has('diagnose')) {
    globalThis.__lastRouteResult = routed;
    document.body.dataset.routeStatus = routed.ok ? 'ROUTE_FOUND' : (routed.status || 'unknown');
    document.body.dataset.routeFailure = routed.failure?.reason || routed.failure?.message || '';
  }
  if (!routed.ok && new URLSearchParams(globalThis.location?.search || '').has('diagnose')) {
    toast(`Route ${routed.status}: ${routed.failure?.reason || routed.failure?.message || 'no diagnostic available'}`);
  }
  if (!routed.ok && routeMode === 'point-to-point') {
    // Preserve both selected endpoints after a failed calculation so the
    // walker can retry or change one endpoint deliberately.
    setPlannerSelecting('End');
    const detail = routed.failure?.reason || routed.failure?.message || routed.status;
    toast(`We couldn't find a walkable route there. ${routeFailureMessage(routed)}`);
  }
  const plan = {
    id: `concept-${Date.now()}`, title: title || `${CITIES[state.activeCity]?.name || 'Local'} ${minutes}-minute sketch`,
    reason: reason || conceptReason(stops), city: state.activeCity, routeMode, estimatedDurationMinutes: minutes,
    stops, coordinates: routed.ok ? routed.coordinates : [], journeyId,
    ...(routed.ok ? { distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), graphStatus: null, graphVersion: routed.graphVersion, cellId: routed.cellId, cellRelease: routed.cellRelease, edgeIds: routed.edgeIds, instructions: routed.instructions } : { graphStatus: routed.status || 'GRAPH_VERSION_UNAVAILABLE', failureMessage: routeFailureMessage(routed) })
  };
  state.plannedRoute = plan; state.planOptions = [plan];
  state.routePlanningFailures = routed.ok ? [] : [...(state.routePlanningFailures || []), routed];
  paintWalkConcept(plan);
  return plan;
}

export function choosePlan(id) { return state.planOptions.find((plan) => plan.id === id) || state.plannedRoute; }
export function selectPlan(id) {
  const plan = choosePlan(id);
  if (!plan) return null;
  state.plannedRoute = plan;
  paintWalkConcept(plan, { fit: false });
  window.dispatchEvent(new CustomEvent('ambient-route-response', { detail: { archetype: plan.archetype, traits: plan.ambientTraits || [], accepted: true } }));
  return plan;
}
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
