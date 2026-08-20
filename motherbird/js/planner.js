import { state } from './state.js';
import { city, poiTags, isWalkablePoi, renderCityPois } from './poi.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml } from './utils.js';
import { routeOnFoot } from './routing.js';
import { quietPlacesNear } from './quiet-places.js';
import { getPoisNearRoute } from './spatial-index.js';
import { parseWalkDescription, saveWalkDraft } from './text-to-walk.js';
import { toast } from './ui.js';

const MILES_PER_MINUTE = 0.05;
const originForPlan = () => state.plannerStart || state.currentPosition || { lat: state.map?.getCenter().lat ?? city().center.lat, lng: state.map?.getCenter().lng ?? city().center.lng };
const activePreferences = () => [...document.querySelectorAll('.planner-chip.active')].map((button) => button.dataset.plannerTag).filter(Boolean);
const selectedMinutes = () => Number(document.querySelector('input[name="walkTime"]:checked')?.value || 15);
const selectedRouteMode = () => document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip';
const bearing = (from, point) => (Math.atan2(point.lng - from.lng, point.lat - from.lat) * 180 / Math.PI + 360) % 360;
const ROUTE_THEMES = { park: 'Green Space', trail: 'Wildlife', history: 'History', quiet: 'Quiet' };
export const ROUTE_OBJECTIVES = [
  { key: 'balanced', label: 'Balanced discovery', styleKey: 'balanced', color: '#2f766d', dashArray: null, dataStatus: 'real', note: 'Time, distance, and public place signals.' },
  { key: 'shortest', label: 'Shortest', styleKey: 'shortest', color: '#a85f4a', dashArray: '3 7', dataStatus: 'real', note: 'Pedestrian route distance.' },
  { key: 'green', label: 'Greener', styleKey: 'green', color: '#6f8f54', dashArray: '12 6', dataStatus: 'real', note: 'Public park, trail, garden, and nature tags.' },
  { key: 'accessible', label: 'Gentler estimate', styleKey: 'accessible', color: '#657ca8', dashArray: '2 5', dataStatus: 'placeholder', note: 'Accessibility tags and route simplicity; grade data is not installed.' },
  { key: 'shade', label: 'Shadier estimate', styleKey: 'shade', color: '#9a729e', dashArray: '9 4 2 4', dataStatus: 'placeholder', note: 'Green-place proxy; tree-canopy and time-of-day shade are not installed.' }
];

function routeTitle(stops, preferences, index) {
  const selectedTheme = preferences.find((tag) => ROUTE_THEMES[tag]);
  const discoveredTheme = stops.flatMap(poiTags).find((tag) => ROUTE_THEMES[tag]);
  const theme = ROUTE_THEMES[selectedTheme || discoveredTheme] || 'Local Discovery';
  const cityName = city().name;
  return `${cityName} ${theme} Loop${index ? ` ${index + 1}` : ''}`;
}

export function setPlanningMode(active) {
  state.planningMode = active;
  document.body.classList.toggle('planning-mode', active);
  if (!active) state.plannerSelecting = null;
  renderCityPois();
}

function candidateStops(origin, preferences, maxDistance = 2600) {
  return [...(state.cityPois[state.activeCity] || []), ...(state.quietFallbackPlaces || [])].filter(isWalkablePoi)
    .filter((poi) => !preferences.length || preferences.includes('quiet') || preferences.some((tag) => poiTags(poi).includes(tag)))
    .map((poi) => ({ poi, distance: distanceMeters(origin, poi), heading: bearing(origin, poi) }))
    .filter(({ distance }) => distance > 80 && distance < maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

function nearbyParkAnchor(origin, maxDistance = 2600) {
  // A large park beside the walker must be a routing constraint, not just one
  // possible discovery among many. The NYC historical-sign import represents
  // Central Park with several records at a shared, in-park coordinate, so use
  // that reliable access point when the walker is nearby.
  const parks = [...(state.cityPois[state.activeCity] || []), ...(state.quietFallbackPlaces || [])]
    .filter(isWalkablePoi)
    .filter((poi) => poiTags(poi).includes('park'))
    .map((poi) => ({ poi, distance: distanceMeters(origin, poi) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => {
      const centralPark = (item) => /\bcentral park\b/i.test(item.poi.name || '') ? 0 : 1;
      return centralPark(a) - centralPark(b) || a.distance - b.distance;
    });
  return parks[0]?.poi || null;
}

function uniqueStops(stops) {
  return stops.filter((stop, index, all) => all.findIndex((other) => other.id === stop.id || (Math.abs(other.lat - stop.lat) < .00005 && Math.abs(other.lng - stop.lng) < .00005)) === index);
}

function endpointLabel(point, fallback) {
  if (!point) return fallback;
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

function renderEndpointStatus(origin, routeMode) {
  el('pointToPointControls').classList.toggle('hidden', routeMode !== 'point-to-point');
  const start = state.plannerStart ? 'custom map point' : state.currentPosition ? 'current location' : 'map center';
  const end = state.plannerEnd ? `destination ${endpointLabel(state.plannerEnd, 'map point')}` : routeMode === 'point-to-point' ? 'destination: a nearby park or place' : 'returns to start';
  el('planEndpoints').textContent = `Start: ${start} · ${end}`;
}

function loopSeeds(origin, preferences, maxDistance) {
  const candidates = candidateStops(origin, preferences, maxDistance);
  // One nearby stop per compass sector produces genuinely different loop shapes.
  return [0, 72, 144, 216, 288].map((heading) => {
    const first = candidates.slice().sort((a, b) => Math.abs((((a.heading - heading) + 540) % 360) - 180) - Math.abs((((b.heading - heading) + 540) % 360) - 180))[0];
    if (!first) return [];
    const second = candidates.filter((item) => item.poi.id !== first.poi.id).sort((a, b) => Math.abs((((a.heading - (first.heading + 70)) + 540) % 360) - 180) - Math.abs((((b.heading - (first.heading + 70)) + 540) % 360) - 180))[0];
    return [first.poi, second?.poi].filter(Boolean);
  }).filter((stops, index, all) => stops.length && all.findIndex((other) => other[0].id === stops[0].id) === index);
}
function sparseAreaLoopSeeds(origin, minutes) {
  // POI availability must never determine whether a person can take a walk.
  // These are route waypoints only; they deliberately create no fake stops.
  const radiusMeters = Math.max(140, Math.min(700, (minutes * MILES_PER_MINUTE * 1609.344) / 4));
  const pointAt = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return { lat: origin.lat + (Math.cos(radians) * radiusMeters) / 111320, lng: origin.lng + (Math.sin(radians) * radiusMeters) / (111320 * Math.cos(origin.lat * Math.PI / 180)) };
  };
  return [0, 120, 240].map((heading) => ({ stops: [], via: [pointAt(heading), pointAt(heading + 90)] }));
}

function interestScore(stops, preferences) {
  const tags = stops.flatMap(poiTags);
  return (preferences.length ? preferences.filter((tag) => tags.includes(tag)).length * 3 : 0) + new Set(tags).size + stops.filter((p) => poiTags(p).includes('history')).length * 2 + stops.reduce((score, stop) => score + (Number(stop.walkRelevanceScore) || 0), 0);
}

function tagsForStops(stops) { return stops.flatMap(poiTags); }
const smoothSurface = (value) => /asphalt|concrete|paved/i.test(String(value || ''));
const noStairs = (value) => !value || /^(0|false|no|none)$/i.test(String(value));
const adaTagged = (value) => /^(yes|true|y|1)$/i.test(String(value || ''));
export function routeEvidence(route, nearby = []) {
  const places = [...(route.stops || []), ...nearby.map((entry) => entry.poi || entry)];
  const accessibleSegments = places.filter((place) => smoothSurface(place.surface) && noStairs(place.stairs)).length;
  const adaPlaces = places.filter((place) => adaTagged(place.accessibility?.ada) || adaTagged(place.wheelchair)).length;
  const restrooms = places.filter((place) => place.restrooms === true || poiTags(place).includes('restrooms')).length;
  const drinkingWater = places.filter((place) => place.drinkingWater === true).length;
  return { accessibleSegments, adaPlaces, restrooms, drinkingWater };
}
function routeComplexity(coordinates = []) {
  let turns = 0;
  for (let index = 2; index < coordinates.length; index += 1) {
    const [aLat, aLng] = coordinates[index - 2]; const [bLat, bLng] = coordinates[index - 1]; const [cLat, cLng] = coordinates[index];
    const first = Math.atan2(bLng - aLng, bLat - aLat); const second = Math.atan2(cLng - bLng, cLat - bLat);
    if (Math.abs(Math.atan2(Math.sin(second - first), Math.cos(second - first))) > 0.65) turns += 1;
  }
  return turns;
}

export function objectiveCost(route, objectiveKey) {
  const tags = tagsForStops(route.stops || []);
  const greenSignals = tags.filter((tag) => ['park', 'trail', 'nature', 'garden', 'water_access'].includes(tag)).length;
  const evidence = routeEvidence(route);
  const accessSignals = evidence.accessibleSegments + evidence.adaPlaces;
  const distance = Number(route.distanceMeters) || Number(route.distanceMiles || 0) * 1609.344;
  const complexity = routeComplexity(route.coordinates);
  if (objectiveKey === 'shortest') return distance;
  if (objectiveKey === 'green') return distance - greenSignals * 700;
  if (objectiveKey === 'accessible') return distance + complexity * 18 - accessSignals * 350;
  if (objectiveKey === 'shade') return distance - greenSignals * 420;
  return distance - Number(route.baseScore || route.score || 0) * 60;
}

function objectiveAlternatives(routes) {
  const unused = new Set(routes);
  const objectives = ROUTE_OBJECTIVES.slice(0, routes.length);
  const assignments = new Map();
  ['shortest', 'balanced', 'green', 'accessible', 'shade'].map((key) => objectives.find((objective) => objective.key === key)).filter(Boolean).forEach((objective) => {
    const pool = unused.size ? [...unused] : routes;
    const route = pool.slice().sort((a, b) => objectiveCost(a, objective.key) - objectiveCost(b, objective.key))[0];
    if (!route) return;
    unused.delete(route);
    assignments.set(objective.key, route);
  });
  return objectives.map((objective) => {
    const route = assignments.get(objective.key);
    if (!route) return null;
    const influences = getPoisNearRoute(route.coordinates, 100).slice(0, 4).map(({ poi, distanceMeters }) => ({ id: poi.id, name: poi.name, distanceMeters: Math.round(distanceMeters), source: poi.source }));
    return { ...route, title: `${objective.label} · ${route.title}`, objective, styleKey: objective.styleKey, color: objective.color, influences, evidence: routeEvidence(route, influences), objectiveCost: Math.round(objectiveCost(route, objective.key)), provenance: { routeGeometry: 'OSM pedestrian router', placeSignals: 'installed regional POI package', objectiveDataStatus: objective.dataStatus } };
  }).filter(Boolean);
}

function pointToPointSeeds(origin, destination, candidates) {
  if (!destination) return [];
  const choose = (tags) => candidates.find(({ poi }) => tags.some((tag) => poiTags(poi).includes(tag)))?.poi;
  const anchors = [null, choose(['history']), choose(['park', 'trail', 'nature']), choose(['accessibility', 'community']), choose(['park', 'nature', 'water_access'])];
  return anchors.map((anchor) => ({ stops: uniqueStops([...(anchor ? [anchor] : []), ...(destination.id ? [destination] : [])]), via: uniqueStops([...(anchor ? [anchor] : []), destination]) }));
}

export async function generateTimeBasedPlan() {
  state.plannedRoute = null; state.planOptions = [];
  el('planDistance').textContent = 'Finding routes…';
  el('planSummary').textContent = 'Looking for walkable options that fit your choices.';
  el('planStops').innerHTML = '';
  el('planOptions').innerHTML = '<p class="empty-state">Finding walkable routes…</p>';
  const minutes = selectedMinutes(); const preferences = activePreferences(); const routeMode = selectedRouteMode(); const origin = routeMode === 'point-to-point' ? originForPlan() : (state.currentPosition || { lat: state.map?.getCenter().lat ?? city().center.lat, lng: state.map?.getCenter().lng ?? city().center.lng });
  renderEndpointStatus(origin, routeMode);
  // Vienna and newly added regions can have very little curated data at first.
  // Quiet OSM places are a private, cached planning fallback—not map clutter.
  const maxStopDistance = Math.max(450, Math.min(2600, minutes * 42));
  if (candidateStops(origin, preferences, maxStopDistance).length < 6) state.quietFallbackPlaces = await quietPlacesNear(state.activeCity, origin);
  const poiSeeds = loopSeeds(origin, preferences, maxStopDistance);
  const parkAnchor = nearbyParkAnchor(origin, maxStopDistance);
  const pointDestination = state.plannerEnd || state.textWalkStops.at(-1) || parkAnchor || poiSeeds[0]?.[0];
  const seeds = routeMode === 'round-trip'
    ? (poiSeeds.length
      ? poiSeeds.map((stops) => {
        const routeStops = uniqueStops(parkAnchor ? [parkAnchor, ...stops] : stops);
        return { stops: routeStops, via: routeStops };
      })
      : sparseAreaLoopSeeds(origin, minutes).map((seed) => parkAnchor ? { stops: [parkAnchor], via: [parkAnchor, ...seed.via] } : seed))
    : pointToPointSeeds(origin, pointDestination, candidateStops(origin, [], maxStopDistance * 1.5));
  const results = await Promise.all(seeds.map(async (seed, index) => {
    const points = routeMode === 'round-trip' ? [origin, ...seed.via, origin] : [origin, ...seed.via];
    const routed = await routeOnFoot(points).catch(() => null);
    if (!routed) return null;
    const miles = routed.distanceMeters / 1609.344;
    const timeFit = Math.max(0, 10 - Math.abs(minutes - routed.durationSeconds / 60) / 3);
    return { id: `plan-${Date.now()}-${index}`, title: routeMode === 'round-trip' ? routeTitle(seed.stops, preferences, index) : `${city().name} point-to-point walk ${index + 1}`, city: state.activeCity, estimatedDurationMinutes: Math.round(routed.durationSeconds / 60), distanceMeters: routed.distanceMeters, distanceMiles: Number(miles.toFixed(2)), routeMode, preferences, stops: seed.stops, coordinates: routed.coordinates, source: 'pedestrian-road-route', baseScore: timeFit + interestScore(seed.stops, preferences) - miles * .15 };
  }));
  state.planOptions = objectiveAlternatives(results.filter(Boolean));
  state.visiblePlanIds = new Set(state.planOptions.map((plan) => plan.id));
  // Point-to-point has one clear route. Loops stay unselected until the
  // walker taps the colored path directly on the map.
  state.plannedRoute = routeMode === 'point-to-point' && state.planOptions.length === 1 ? state.planOptions[0] : null;
  previewTimeBasedPlan();
  renderPlanPreview();
  return state.plannedRoute;
}

export function choosePlan(id) { state.plannedRoute = state.planOptions.find((plan) => plan.id === id) || state.plannedRoute; renderPlanPreview(); previewTimeBasedPlan(); }
export function changePlan() { state.plannedRoute = null; renderPlanPreview(); previewTimeBasedPlan(); }
export function togglePlanVisibility(id, visible) { if (visible) state.visiblePlanIds.add(id); else state.visiblePlanIds.delete(id); previewTimeBasedPlan(); renderPlanPreview(); }

export async function draftWalkFromText(text) {
  const parsed = parseWalkDescription(text, state.cityPois[state.activeCity] || []);
  if (!parsed.description) { toast('Describe the walk you want to take first.'); return null; }
  const timeValues = [15, 30, 45, 60]; const closestTime = timeValues.slice().sort((a, b) => Math.abs(a - parsed.durationMinutes) - Math.abs(b - parsed.durationMinutes))[0];
  const timeInput = document.querySelector(`input[name="walkTime"][value="${closestTime}"]`); if (timeInput) timeInput.checked = true;
  document.querySelectorAll('.planner-chip').forEach((button) => button.classList.toggle('active', parsed.preferences.includes(button.dataset.plannerTag)));
  state.textWalkStops = parsed.matchedPois;
  if (parsed.matchedPois.length) {
    const routeInput = document.querySelector('input[name="routeMode"][value="point-to-point"]'); if (routeInput) routeInput.checked = true;
    state.plannerStart = parsed.matchedPois.length > 1 ? parsed.matchedPois[0] : null; state.plannerEnd = parsed.matchedPois.at(-1);
  }
  await saveWalkDraft(state.activeCity, parsed);
  toast(parsed.matchedPois.length ? `Drafted from ${parsed.matchedPois.map((poi) => poi.name).join(' and ')}. You can still edit every choice.` : 'Drafted from your themes. You can still edit every choice.');
  return generateTimeBasedPlan();
}

export function renderPlanPreview() {
  const plan = state.plannedRoute;
  el('planOptions').innerHTML = state.planOptions.length
    ? `<p class="planner-map-hint">${plan ? 'Selected route stays bright; the others remain softly visible.' : `${state.planOptions.length} named alternatives are shown together.`}</p>${state.planOptions.map((option) => `<article class="route-option ${option.id === plan?.id ? 'active' : ''}"><label class="route-visibility"><input type="checkbox" data-route-toggle="${escapeHtml(option.id)}" ${state.visiblePlanIds.has(option.id) ? 'checked' : ''} aria-label="Show ${escapeHtml(option.objective.label)}" /><span style="--route-swatch:${option.color}"></span></label><button type="button" data-plan-option="${escapeHtml(option.id)}"><strong>${escapeHtml(option.objective.label)}</strong><small>${option.distanceMiles} mi · ${option.estimatedDurationMinutes} min · ${escapeHtml(option.objective.note)}</small></button><b>${option.id === plan?.id ? 'Selected' : 'Choose'}</b></article>`).join('')}`
    : '<p class="empty-state">No walkable route could be calculated here. Try a different start point or time.</p>';
  const influencePanel = el('planInfluences');
  if (!plan) { influencePanel.classList.add('hidden'); el('planDistance').textContent = state.planOptions.length ? `${state.planOptions.length} routes ready` : 'No route yet'; el('planSummary').textContent = state.planOptions.length ? 'Compare the named objectives, hide any you do not need, then choose a line or card.' : 'Adjust the time, route shape, or starting point and try again.'; el('planStops').innerHTML = ''; return; }
  el('planDistance').textContent = `${plan.distanceMiles} miles`;
  const discoveries = plan.stops.slice(0, 2).map((stop) => stop.name).join(' and ');
  el('planSummary').textContent = discoveries
    ? `${plan.estimatedDurationMinutes}-minute ${plan.routeMode === 'round-trip' ? 'loop back to your start' : 'walk'} with ${discoveries}.`
    : `${plan.estimatedDurationMinutes}-minute ${plan.routeMode === 'round-trip' ? 'loop back to your start' : 'walk'} ranked for time and distance.`;
  el('planStops').innerHTML = plan.stops.map((stop, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(stop.name)}</strong><small>${escapeHtml(stop.sourceType === 'osm-quiet-fallback' ? 'quiet place · OpenStreetMap' : poiTags(stop).find((tag) => !tag.startsWith('history_')) || 'place')}</small></li>`).join('');
  influencePanel.classList.remove('hidden');
  const support = [];
  if (plan.evidence?.accessibleSegments) support.push(`${plan.evidence.accessibleSegments} paved or stair-free local segments`);
  if (plan.evidence?.adaPlaces) support.push(`${plan.evidence.adaPlaces} ADA-tagged places`);
  if (plan.evidence?.restrooms) support.push(`${plan.evidence.restrooms} restroom locations`);
  if (plan.evidence?.drinkingWater) support.push(`${plan.evidence.drinkingWater} water locations`);
  influencePanel.innerHTML = `${plan.influences.length ? plan.influences.map((item) => `<span class="influence-chip">${escapeHtml(item.name)} · ${item.distanceMeters}m</span>`).join('') : '<span class="influence-chip">No nearby public POI influenced this route</span>'}${support.length ? `<small class="provenance-note">Local support near this route: ${escapeHtml(support.join(' · '))}.</small>` : ''}<small class="provenance-note">${escapeHtml(plan.objective.label)}: ${escapeHtml(plan.objective.note)} Geometry: ${escapeHtml(plan.provenance.routeGeometry)}.</small>`;
}

export function previewTimeBasedPlan({ fit = false } = {}) {
  if (!state.map) return null;
  state.plannedRouteLine?.remove();
  state.plannedRouteLines?.forEach((line) => line.remove());
  state.plannedRouteLine = null;
  const visibleOptions = state.planOptions.filter((plan) => plan.coordinates?.length && state.visiblePlanIds.has(plan.id));
  state.plannedRouteLines = visibleOptions.map((option) => {
    const selected = option.id === state.plannedRoute?.id;
    const line = L.polyline(option.coordinates, routeLineStyle(option, selected)).addTo(state.map); line.routeId = option.id;
    line.on('click', () => { choosePlan(option.id); window.dispatchEvent(new CustomEvent('planner-route-selected')); });
    line.on('mouseover', () => { line.setStyle({ ...routeLineStyle(option, selected), weight: selected ? 9 : 7, opacity: 1 }); line.bringToFront(); });
    line.on('mouseout', () => line.setStyle(routeLineStyle(option, option.id === state.plannedRoute?.id)));
    line.bindTooltip(`${option.objective.label} · ${option.distanceMiles} mi${selected ? ' · selected' : ' · tap to select'}`, { sticky: true });
    return line;
  });
  state.plannedRouteLine = state.plannedRoute ? state.plannedRouteLines.find((line) => line.routeId === state.plannedRoute.id) || null : null;
  if (fit && state.plannedRouteLines.length) {
    const bounds = L.featureGroup(state.plannedRouteLines).getBounds();
    if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }
  return state.plannedRoute;
}

function routeLineStyle(option, selected) { return { color: option.color, weight: selected ? 8 : 4.5, opacity: selected ? 0.98 : 0.62, dashArray: selected ? null : option.objective.dashArray, lineCap: 'round', lineJoin: 'round' }; }

export function lockSelectedPlanOnMap() {
  const plan = state.plannedRoute;
  if (!state.map || !plan?.coordinates?.length) return null;
  state.plannedRouteLine?.remove();
  state.plannedRouteLines?.forEach((line) => line.remove());
  state.plannedRouteLines = [];
  state.plannedRouteLine = L.polyline(plan.coordinates, { color: plan.color || '#1b8b7e', weight: 7, opacity: .95 }).addTo(state.map);
  return plan;
}
