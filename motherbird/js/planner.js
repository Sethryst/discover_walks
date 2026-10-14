import { state } from './state.js';
import { setPlannerSelecting } from './planner-selection.js?v=20261004-planner-selection-1';
import { CITIES } from './constants.js';
import { poiTags } from './poi.js';
import { routeOnFoot, routeFailureMessage } from './routing.js?v=20261011-cross-cell-stitch-3';
import { escapeHtml } from './utils.js';
import { toast } from './ui.js';
import { buildAmbientExplanation, generateAmbientOptions, installAmbientLearningListener, readAmbientMemory } from './ambient-mip.js?v=20261007-walk-moods-1';
import { createWalkPlan, saveWalkPlan } from './walk-plan.js';
import { recipeFromDocument, recipeCandidateAllowed, recipeRequest } from './walk-recipes.js';

function selectedMinutes() { return Number(document.querySelector('input[name="walkTime"]:checked')?.value || 30); }
function selectedRouteMode() { return document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip'; }
function plannerOrigin() { return state.plannerStart || state.currentPosition || state.lastPosition || state.map?.getCenter() || CITIES[state.activeCity].center; }
let generation = 0;
installAmbientLearningListener();

const AUTO_ROUTE_MAX_CANDIDATES = 14;
const AUTO_ROUTE_MAX_STOPS = 7;

function interests() {
  const pressed = [...document.querySelectorAll('[data-start-interest][aria-pressed="true"]')].map((button) => button.dataset.startInterest);
  return pressed.length ? pressed : (state.settings.favoriteCategories || []);
}

export function candidateStops(origin, tags) {
  // Region packs use both the legacy top-level coordinates and the newer
  // `{ location: { lat, lng } }` shape. Normalize before filtering so auto
  // round trips do not report "no candidates" for valid place records.
  const imported = (state.cityPois[state.activeCity] || []);
  const workspacePlaces = (state.personalPlaces || [])
    .filter((place) => !place.packId || place.packId === state.activeCity)
    .map((place) => ({
      ...place,
      lat: place.lat ?? place.location?.lat,
      lng: place.lng ?? place.location?.lng,
      tags: [...new Set([...(place.tags || []), place.categoryId, place.category_id, place.chipId, place.chip_id, place.light === 'cuisine' ? place.chipId || place.chip_id : null].filter(Boolean))],
      workspacePlace: true
    }));
  const candidates = [...imported, ...workspacePlaces]
    .filter((poi) => poi.category !== 'journey')
    .map(normalizeStop)
    .filter(Boolean);
  const score = (poi) => {
    const poiTagSet = new Set(poiTags(poi));
    const interest = tags.filter((tag) => poiTagSet.has(tag)).length * 8;
    const distance = Math.hypot((poi.lat - origin.lat) * 111, (poi.lng - origin.lng) * 88);
    const tagsForStop = poiTags(poi);
    const categoryValue = tagsForStop.some((tag) => ['coffee', 'coffee_shop', 'cafe', 'tea', 'restaurant', 'market'].includes(tag)) ? 3 : 0;
    const workspaceValue = poi.workspacePlace ? 5 : 0;
    return interest + categoryValue + workspaceValue + Number(poi.walkRelevanceScore || 0) - distance;
  };
  return [...new Map(candidates.map((poi) => [`${poi.name}|${poi.lat.toFixed(5)}|${poi.lng.toFixed(5)}`, poi])).values()]
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
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

function fallbackAutoRoundTripStop(origin, minutes) {
  // A POI is helpful context, not a prerequisite for a walk. Give the
  // router a nearby exploratory waypoint when the region has no places.
  const distanceKm = Math.min(1.2, Math.max(0.35, minutes * 0.015));
  const bearing = Math.PI / 4;
  const lngScale = Math.max(0.25, Math.cos(origin.lat * Math.PI / 180));
  return {
    name: 'Exploration waypoint',
    lat: origin.lat + (Math.cos(bearing) * distanceKm / 111),
    lng: origin.lng + (Math.sin(bearing) * distanceKm / (111 * lngScale)),
    generated: true
  };
}

function conceptReason(stops) {
  const tags = [...new Set(stops.flatMap(poiTags))];
  const ground = tags.includes('trail') ? 'trail and named-place ground' : tags.some((tag) => ['park', 'nature', 'wildlife'].includes(tag)) ? 'green and wildlife ground' : 'neighborhood place ground';
  return `${ground[0].toUpperCase()}${ground.slice(1)} · ${stops.length} stop${stops.length === 1 ? '' : 's'} · ${stops.map((stop) => stop.name).slice(0, 2).join(' and ')}`;
}

const AUTO_LOOP_RETRY_STATUSES = new Set(['BOUNDARY_STITCH_FAILED', 'CROSS_CELL_UNAVAILABLE']);

function stopValue(stop, interests = []) {
  const tags = new Set(poiTags(stop));
  const interest = interests.filter((tag) => tags.has(tag)).length * 8;
  const useful = ['coffee', 'coffee_shop', 'cafe', 'tea', 'restaurant', 'market', 'park', 'trail', 'nature', 'history', 'culture', 'water'];
  return 1 + interest + useful.filter((tag) => tags.has(tag)).length * 2 + (stop.workspacePlace ? 5 : 0) + Number(stop.walkRelevanceScore || 0);
}

function routeReusePenalty(route) {
  const ids = (route?.edgeIds || []).map(String);
  if (ids.length < 2) return 0;
  return (ids.length - new Set(ids).size) / ids.length;
}

async function routeAutoRoundTrip(stops, center, options, { candidatePool = stops, minutes = 30, interests = [] } = {}) {
  // Start with the highest-value workspace/imported candidates, but choose the
  // actual sequence by repeatedly testing the whole loop on the pedestrian
  // graph. This avoids the old straight-line ordering and backtracking trap.
  const pool = [...new Map([...candidatePool, ...stops].map((stop) => [`${stop.name}|${stop.lat.toFixed(5)}|${stop.lng.toFixed(5)}`, stop])).values()]
    .sort((a, b) => stopValue(b, interests) - stopValue(a, interests) || distanceBetween(center, a) - distanceBetween(center, b))
    .slice(0, AUTO_ROUTE_MAX_CANDIDATES);
  const budgetSeconds = Math.max(1, Number(minutes || 30)) * 60;
  const selected = [];
  let bestRoute = null;
  let lastFailure = null;

  for (let round = 0; round < AUTO_ROUTE_MAX_STOPS && selected.length < pool.length; round += 1) {
    let best = null;
    for (const stop of pool) {
      if (selected.includes(stop)) continue;
      const attemptStops = [...selected, stop];
      const routed = await routeOnFoot([center, ...attemptStops, center], options).catch((error) => ({ ok: false, status: 'ROUTING_WORKER_ERROR', failure: { message: error?.message || 'Offline routing failed.' } }));
      if (!routed.ok) { lastFailure = routed; continue; }
      const durationSeconds = Number(routed.durationSeconds || Infinity);
      if (durationSeconds > budgetSeconds) continue;
      const addedMinutes = Math.max(0, (durationSeconds - Number(bestRoute?.durationSeconds || 0)) / 60);
      const score = stopValue(stop, interests) / (1 + addedMinutes) - routeReusePenalty(routed) * 10;
      if (!best || score > best.score || (score === best.score && durationSeconds < best.routed.durationSeconds)) best = { stop, routed, score };
    }
    if (!best) break;
    selected.push(best.stop);
    bestRoute = best.routed;
  }

  if (bestRoute) return { routed: bestRoute, stops: selected };
  return { routed: lastFailure || { ok: false, status: 'GRAPH_VERSION_UNAVAILABLE' }, stops: selected.length ? selected : stops.slice(0, 1) };
}

function planningFailureMessage(result, routeMode) {
  if (routeMode === 'auto-round-trip' && AUTO_LOOP_RETRY_STATUSES.has(result?.status)) {
    return 'We could not build a complete loop in the installed walking coverage. Try a shorter walk or move the map slightly and try again.';
  }
  if (routeMode === 'round-trip' && AUTO_LOOP_RETRY_STATUSES.has(result?.status)) {
    return 'This round trip crosses a boundary the installed walking network cannot safely join. Choose a nearer destination or try a different mapped area.';
  }
  if (['ROUTING_TIMEOUT', 'ROUTING_GRAPH_UNAVAILABLE', 'ROUTING_WORKER_ERROR'].includes(result?.status)) {
    return 'The walking network is still loading or temporarily unavailable. Try this route again in a moment.';
  }
  return routeFailureMessage(result);
}

export function paintWalkConcept(plan = state.plannedRoute, { fit = true } = {}) {
  if (!plan || !state.map) return null;
  state.planSketchLayer?.remove();
  state.plannedRouteLine?.remove();
  state.plannedRouteLines?.forEach((line) => line.remove());
  state.plannerRouteCasingLines?.forEach((line) => line.remove());
  state.plannerRouteGapLines?.forEach((line) => line.remove());
  state.planSketchLayer = L.layerGroup().addTo(state.map);
  const routePane = state.map.getPane('plannerRoutePane') || state.map.createPane('plannerRoutePane');
  routePane.style.zIndex = '720';
  routePane.style.pointerEvents = 'none';
  const mood = plan.archetype || 'direct';
  plan.stops.forEach((stop, index) => L.marker([stop.lat, stop.lng], { icon: L.divIcon({ className: `sketch-stop sketch-stop--${mood}`, html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: stop.name }).bindTooltip(stop.name).addTo(state.planSketchLayer));
  // Paint only geometry returned by the pedestrian router. Never connect
  // endpoints with a synthetic straight segment when a route is missing;
  // that makes a failed or partial auto-loop look like a valid walk.
  const routePaths = (plan.coordinates?.length || 0) > 1
    ? [plan.coordinates]
    : [];
  // Use a contrasting casing so the route remains obvious over satellite,
  // OSM, and greenway basemaps instead of disappearing into dark map detail.
  if (mood === 'discovery') ensureDiscoveryGradient(state.map);
  const style = globalThis.__MOTHERBIRD_MAP_STYLE__;
  const routeColors = { direct: style?.features?.plannedRoute || '#59C36A', discovery: style?.features?.discoveryRoute || '#168AAD', quiet: style?.features?.recordedRoute || '#168AAD' };
  const casingColors = { direct: style?.appearance?.casing || '#1f6b43', discovery: style?.appearance?.casing || '#0d5570', quiet: style?.appearance?.casing || '#123b72' };
  const routeCasingLines = routePaths.map((coordinates) => L.polyline(coordinates, { pane: 'plannerRoutePane', color: casingColors[mood] || casingColors.direct, weight: 11, opacity: .98, lineCap: 'round', lineJoin: 'round', dashArray: mood === 'quiet' ? '10 8' : null, styleRole: 'plannedCasing' }).addTo(state.map));
  state.plannedRouteLines = routePaths.map((coordinates) => L.polyline(coordinates, { pane: 'plannerRoutePane', color: routeColors[mood] || routeColors.direct, weight: style?.features?.routeWidth || 8, opacity: style?.features?.routeOpacity || 1, lineCap: 'round', lineJoin: 'round', dashArray: mood === 'quiet' ? '10 8' : null, styleRole: 'plannedRoute' }).addTo(state.map));
  [...routeCasingLines, ...state.plannedRouteLines].forEach((line) => line.bringToFront());
  state.plannerRouteCasingLines = routeCasingLines;
  // Gap overlays are optional diagnostics. Keep the slot explicit even when
  // no gap analysis was requested so a normal route (including auto loops)
  // can finish painting and fitting the map without a dangling reference.
  const gapLines = [];
  state.plannerRouteGapLines = gapLines;
  const restoreRouteOverlay = () => {
    [...(state.plannerRouteCasingLines || []), ...(state.plannedRouteLines || []), ...(state.plannerRouteGapLines || [])].forEach((line) => {
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
  // Point-to-point is destination-bounded. The selected walk time can still
  // describe the user's preference, but must not reject a valid route to the
  // destination simply because it exceeds the default 30 minutes.
  const availableMinutes = routeMode === 'point-to-point' ? Infinity : minutes;
  const center = plannerOrigin();
  const recipe = recipeFromDocument();
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
  const autoCandidates = candidateStops(center, interests());
  const autoRadiusKm = Math.max(1.5, minutes * 0.08);
  const nearbyAutoCandidates = autoCandidates.filter((stop) => {
    const normalized = normalizeStop(stop, 0);
    return normalized && recipeCandidateAllowed(normalized, recipe) && distanceBetween(center, normalized) <= autoRadiusKm;
  });
  const rawStops = needsMapDestination
    ? [...selectedStops, { name: 'Selected destination', lat: state.plannerEnd.lat, lng: state.plannerEnd.lng }]
    : (seededStops?.length
      ? seededStops
      : (nearbyAutoCandidates.length >= count ? nearbyAutoCandidates : autoCandidates).slice(0, count)
        .concat(autoCandidates.length ? [] : [fallbackAutoRoundTripStop(center, minutes)]))
      .map(normalizeStop).filter(Boolean);
  let stops = routeMode === 'auto-round-trip' ? orderAutoRoundTripStops(rawStops, center) : rawStops;
  if (!stops.length && routeMode !== 'auto-round-trip') {
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
    let ambient = { routes: [] };
    try {
      ambient = await generateAmbientOptions({ origin: routeOrigin, destination: state.plannerEnd, routeOnFoot, context: { availableMinutes, destination: state.plannerEnd, currentPaceMps: state.walk?.paceMps, routeHistoryCount: state.walks?.length || 0, rememberedPlaceCount: state.personalPlaces?.length || 0, avoidEdges: state.routingConstraints?.avoidEdges || state.avoidEdges || [], graphVersion: state.routingConstraints?.graphVersion || null, cellRelease: state.routingConstraints?.cellRelease || null }, memory: localMemory, discoveryStops, quietStops });
    } catch (error) {
      console.warn('Ambient route options unavailable; falling back to direct routing:', error);
    }
    if (requestGeneration !== generation) return null;
    if (ambient.routes.length) {
      const optionRoutes = ambient.primary ? [ambient.primary, ...(ambient.alternatives || [])] : ambient.routes;
      const plans = optionRoutes.slice(0, 3).map((routed, index) => ({
        id: routed.id, title: index === 0 ? (title || 'A good walk from here') : (routed.archetype === 'discovery' ? (routed.facts?.discoveryFocus === 'historic-cultural' ? 'More history to notice' : routed.facts?.discoveryFocus === 'nature-trail' ? 'More nature to notice' : 'More to notice') : 'Quieter where mapped'),
        reason: buildAmbientExplanation(routed),
        city: state.activeCity, routeMode, estimatedDurationMinutes: Math.round(Number(routed.durationSeconds || 0) / 60),
        stops: routed.stops || [{ name: 'Selected destination', lat: state.plannerEnd.lat, lng: state.plannerEnd.lng }], coordinates: routed.coordinates,
        distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), graphStatus: null, graphVersion: routed.graphVersion,
        cellId: routed.cellId, cellRelease: routed.cellRelease, edgeIds: routed.edgeIds, avoidEdges: routed.avoidEdges || [], instructions: routed.instructions, destination: state.plannerEnd,
        archetype: routed.archetype, profile: routed.profile || 'ordinary_walking_beta', facts: routed.facts, ambientTraits: routed.ambientTraits || [], ambientIntention: ambient.intention
      }));
      state.planOptions = plans; state.plannedRoute = ambient.primary ? plans.find((plan) => plan.id === ambient.primary.id) || plans[0] : plans[0];
      const selected = state.plannedRoute;
      await saveWalkPlan(createWalkPlan({ planId: state.walkPlan?.id || null, revision: Number(state.walkPlan?.revision || 0) + 1, request: { city: state.activeCity, origin: routeOrigin, destination: state.plannerEnd, durationMinutes: minutes, routeMode, interests: interests() }, route: selected, encounters: (selected.stops || []).map((stop, index) => ({ ...stop, placeId: stop.id, position: index, reason: 'Selected by the route-and-encounter scorer.' })), rationale: { summary: selected.reason, limitations: [] } }));
      paintWalkConcept(state.plannedRoute);
      window.dispatchEvent(new CustomEvent('ambient-routes-ready', { detail: { options: plans, intention: ambient.intention } }));
      return state.plannedRoute;
    }
  }
  const routeOptions = { city: state.activeCity, profile: recipe.profile === 'accessible_verified' ? 'accessible_verified' : 'ordinary_walking_beta' };
  let routed;
  if (routeMode === 'auto-round-trip') {
    const candidatePool = (seededStops?.length ? stops : nearbyAutoCandidates.length ? nearbyAutoCandidates : autoCandidates).slice(0, AUTO_ROUTE_MAX_CANDIDATES);
    const autoRoute = await routeAutoRoundTrip(stops, center, routeOptions, { candidatePool, minutes, interests: interests() });
    routed = autoRoute.routed;
    stops = autoRoute.stops;
  } else {
    const points = routeMode === 'round-trip' ? [center, ...stops, center] : [routeOrigin, ...stops];
    routed = await routeOnFoot(points, routeOptions).catch((error) => ({ ok: false, status: 'ROUTING_WORKER_ERROR', failure: { message: error?.message || 'Offline routing failed.' } }));
  }
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
    toast(`We could not find a walkable route there. ${planningFailureMessage(routed, routeMode)}`);
  }
  // Auto and round-trip modes already retry with simpler route shapes. Keep
  // failed attempts quiet so internal graph boundaries do not become a user
  // error stream; diagnostics remain available behind ?diagnose.
  const plan = {
    id: `concept-${Date.now()}`, title: title || (routeMode === 'point-to-point' ? 'A route to your destination' : `${CITIES[state.activeCity]?.name || 'Local'} ${minutes}-minute sketch`),
    reason: reason || conceptReason(stops), city: state.activeCity, routeMode, estimatedDurationMinutes: routed.ok ? Math.round(Number(routed.durationSeconds || 0) / 60) : minutes,
    stops, coordinates: routed.ok ? routed.coordinates : [], journeyId,
    ...(routed.ok ? { distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), graphStatus: null, graphVersion: routed.graphVersion, cellId: routed.cellId, cellRelease: routed.cellRelease, edgeIds: routed.edgeIds, instructions: routed.instructions } : { graphStatus: routed.status || 'GRAPH_VERSION_UNAVAILABLE', failureMessage: planningFailureMessage(routed, routeMode) })
  };
  state.plannedRoute = plan; state.planOptions = [plan];
  if (routed.ok) await saveWalkPlan(createWalkPlan({ request: recipeRequest(recipe, { city: state.activeCity, origin: routeOrigin, durationMinutes: minutes, routeMode, interests: interests() }), route: routed, encounters: stops.map((stop, index) => ({ ...stop, placeId: stop.id, position: index, reason: 'Selected by the route-and-encounter scorer.' })), rationale: { summary: plan.reason, limitations: [] } }));
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

function ensureDiscoveryGradient(map) {
  const svg = map.getPanes().overlayPane?.querySelector('svg');
  if (!svg || svg.querySelector('#walkDiscoveryGradient')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<linearGradient id="walkDiscoveryGradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#168AAD"/><stop offset="100%" stop-color="#59C36A"/></linearGradient>';
  svg.prepend(defs);
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
