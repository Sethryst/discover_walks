import { state } from './state.js';
import { CITIES } from './constants.js';
import { poiTags } from './poi.js';
import { routeOnFoot } from './routing.js';
import { escapeHtml } from './utils.js';

function selectedMinutes() { return Number(document.querySelector('input[name="walkTime"]:checked')?.value || 30); }
function selectedRouteMode() { return document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip'; }

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
  state.planSketchLayer = L.layerGroup().addTo(state.map);
  plan.stops.forEach((stop, index) => L.marker([stop.lat, stop.lng], { icon: L.divIcon({ className: 'sketch-stop', html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: stop.name }).bindTooltip(stop.name).addTo(state.planSketchLayer));
  if (plan.coordinates?.length > 1) state.plannedRouteLine = L.polyline(plan.coordinates, { color: '#173c35', weight: 6, opacity: .9 }).addTo(state.map);
  const layers = [...state.planSketchLayer.getLayers(), ...(state.plannedRouteLine ? [state.plannedRouteLine] : [])];
  if (fit && layers.length) { const bounds = L.featureGroup(layers).getBounds(); if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [42, 42], maxZoom: 16 }); }
  window.dispatchEvent(new CustomEvent('walk-sketch-painted', { detail: plan }));
  return plan;
}

export async function generateTimeBasedPlan({ stops: seededStops = null, title = null, reason = null, journeyId = null } = {}) {
  const minutes = selectedMinutes();
  const routeMode = selectedRouteMode();
  const center = state.currentPosition || state.map?.getCenter() || CITIES[state.activeCity].center;
  const count = minutes <= 20 ? 2 : minutes >= 60 ? 4 : 3;
  const stops = seededStops?.length ? seededStops : candidateStops(center, interests()).slice(0, count);
  if (!stops.length) return null;
  const points = routeMode === 'round-trip' ? [center, ...stops, center] : [center, ...stops];
  const routed = await routeOnFoot(points, { city: state.activeCity, profile: 'ordinary_walking_beta' }).catch(() => ({ ok: false, status: 'GRAPH_VERSION_UNAVAILABLE' }));
  const plan = {
    id: `concept-${Date.now()}`, title: title || `${CITIES[state.activeCity]?.name || 'Local'} ${minutes}-minute sketch`,
    reason: reason || conceptReason(stops), city: state.activeCity, routeMode, estimatedDurationMinutes: minutes,
    stops, coordinates: routed.ok ? routed.coordinates : [], journeyId,
    ...(routed.ok ? { distanceMeters: routed.distanceMeters, distanceMiles: Number((routed.distanceMeters / 1609.344).toFixed(2)), graphVersion: routed.graphVersion } : { graphStatus: routed.status || 'GRAPH_VERSION_UNAVAILABLE' })
  };
  state.plannedRoute = plan; state.planOptions = [plan];
  paintWalkConcept(plan);
  return plan;
}

export function choosePlan(id) { return state.planOptions.find((plan) => plan.id === id) || state.plannedRoute; }
export function changePlan() { state.plannedRoute = null; state.planSketchLayer?.remove(); state.plannedRouteLine?.remove(); }
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
