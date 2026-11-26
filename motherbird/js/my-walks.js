import db from './storage.js';
import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { routeOnFoot } from './routing.js';
import { buildDiscoveryOpportunities, buildRouteCorridor, normalizeTransportationMode } from './route-intelligence.js';
import { buildMemoryPalaceContext } from './memory-palace.js';

const MAX_CONNECTIONS = 12;
const MAX_DISTANCE_METERS = 12000;
const MIN_DISTANCE_METERS = 120;
const INTEREST_TAGS = {
  wildlife: ['wildlife', 'bird', 'nature'], history: ['history', 'historic', 'heritage'], water: ['water', 'river', 'creek', 'wetland'],
  forests: ['forest', 'woodland', 'tree', 'nature'], coffee: ['coffee', 'cafe', 'café'], architecture: ['architecture', 'building'],
  quiet: ['quiet', 'rest', 'scenic'], unfamiliar: []
};

function locationOf(place) {
  const lat = Number(place?.location?.lat ?? place?.lat);
  const lng = Number(place?.location?.lng ?? place?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function pairId(a, b) { return `auto-walk:${[a.id, b.id].sort().join(':')}`; }

function fallbackTitle(a, b) {
  const left = a.name?.trim() || 'Logged place';
  const right = b.name?.trim() || 'Nearby place';
  return `${left} to ${right}`.slice(0, 100);
}

function fallbackSections(coordinates, distance) {
  return buildAutomaticSections(coordinates, distance);
}

function buildAutomaticSections(coordinates = [], distance = 0) {
  if (coordinates.length < 4 || distance < 300) return [{
    id: 'section-main', title: 'Main connection', notes: 'Automatically generated from two logged places.',
    coordinates, geometry: null, stops: [], distanceMeters: distance, durationSeconds: Math.round(distance / 1.35),
    status: 'upcoming', alternatives: [], mip: null
  }];
  const count = distance >= 1800 ? 3 : 2;
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * (coordinates.length - 1) / count);
    const end = Math.floor((index + 1) * (coordinates.length - 1) / count);
    const points = coordinates.slice(start, end + 1);
    const segmentDistance = points.slice(1).reduce((sum, point, pointIndex) => sum + distanceMeters({ lat: points[pointIndex][0], lng: points[pointIndex][1] }, { lat: point[0], lng: point[1] }), 0);
    const title = count === 3 ? ['Opening stretch', 'Middle stretch', 'Arrival stretch'][index] : ['First stretch', 'Second stretch'][index];
    segments.push({ id: `section-${index + 1}`, title, notes: 'Automatically divided from the route geometry; rename or merge it as your understanding grows.', coordinates: points, geometry: null, stops: [], distanceMeters: Math.round(segmentDistance), durationSeconds: Math.round(segmentDistance / 1.35), status: 'upcoming', alternatives: [], mip: null });
  }
  return segments;
}

function ensureAutomaticSections(route) {
  const main = (route.sections || []).filter((section) => !section.isDetour);
  if (main.length > 1 || !route.coordinates?.length) return main;
  return buildAutomaticSections(route.coordinates, Number(route.distanceMeters) || 0).map((section) => ({ ...section, enabled: main[0]?.enabled !== false }));
}

function candidatePairs(places) {
  const pairs = [];
  for (let left = 0; left < places.length; left += 1) {
    const a = places[left], aLocation = locationOf(a);
    if (!aLocation) continue;
    for (let right = left + 1; right < places.length; right += 1) {
      const b = places[right], bLocation = locationOf(b);
      if (!bLocation) continue;
      const distance = distanceMeters(aLocation, bLocation);
      if (distance >= MIN_DISTANCE_METERS && distance <= MAX_DISTANCE_METERS) pairs.push({ a, b, aLocation, bLocation, distance });
    }
  }
  return pairs.sort((left, right) => left.distance - right.distance).slice(0, MAX_CONNECTIONS);
}

function poiLocation(poi) {
  const lat = Number(poi?.lat ?? poi?.location?.lat), lng = Number(poi?.lng ?? poi?.location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function poiTags(poi) { return [...new Set([poi?.category, poi?.categoryId, poi?.chipId, poi?.light, ...(poi?.tags || [])].filter(Boolean).map((tag) => String(tag).toLowerCase()))]; }

function nearestRoutePoint(coordinates, location) {
  return coordinates.reduce((best, point) => {
    const candidate = { lat: Number(point[0]), lng: Number(point[1]) };
    return distanceMeters(candidate, location) < distanceMeters(best, location) ? candidate : best;
  }, { lat: Number(coordinates[0][0]), lng: Number(coordinates[0][1]) });
}

async function buildInterestDetours(route, interests, city) {
  if (!interests.length || !route.coordinates?.length || !state.cityPois?.[city]) return [];
  const candidates = buildDiscoveryOpportunities({ route, interests, objects: state.cityPois[city] }).slice(0, 3).map((discovery) => {
    const poi = discovery.object;
    const location = poiLocation(poi);
    return { ...discovery, poi, location, anchor: location ? nearestRoutePoint(route.coordinates, location) : null, distance: discovery.corridorDistanceMeters };
  }).filter((item) => item.location && item.anchor);
  const detours = [];
  for (const candidate of candidates) {
    const name = candidate.poi.name || 'Nearby discovery';
    const routeResult = await routeOnFoot([[candidate.anchor.lat, candidate.anchor.lng], [candidate.location.lat, candidate.location.lng], [candidate.anchor.lat, candidate.anchor.lng]], { city }).catch(() => null);
    const coordinates = routeResult?.ok ? routeResult.coordinates : [[candidate.anchor.lat, candidate.anchor.lng], [candidate.location.lat, candidate.location.lng], [candidate.anchor.lat, candidate.anchor.lng]];
    const discoveryId = candidate.id;
    detours.push({ id: `detour-${route.id}-${candidate.poi.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, discoveryId, title: `${interests[0] || 'Discovery'} detour · ${name}`, notes: `Suggested because this route is near a place matching your ${interests.join(' and ')} interest.`, coordinates, distanceMeters: Number(routeResult?.distanceMeters) || distanceMeters(candidate.anchor, candidate.location) * 2, durationSeconds: Number(routeResult?.durationSeconds) || 0, status: 'upcoming', enabled: false, isDetour: true, interest: interests[0] || null, stops: [{ id: candidate.poi.id || name, name, ...candidate.location }] });
  }
  return detours;
}

function routeDiscoveries(route, interests, city, exploredIds = []) {
  return buildDiscoveryOpportunities({ route, interests, exploredIds, objects: state.cityPois?.[city] || [] }).slice(0, 12);
}

export async function reconcileMyWalks({ city = state.activeCity } = {}) {
  const places = (await db.all('personal_places')).filter((place) => place?.state !== 'candidate' && locationOf(place));
  if (places.length < 2) return { generated: 0, candidates: 0 };
  const existing = await db.all('saved_routes');
  const [memories, observations, experiences] = await Promise.all([db.all('moments'), db.all('observations'), db.all('walks')]);
  const existingAuto = new Map(existing.filter((route) => route.generatedFrom === 'personal-place-pair').map((route) => [route.id, route]));
  let generated = 0;
  const interests = Array.isArray(state.settings?.favoriteCategories) ? state.settings.favoriteCategories : [];
  for (const pair of candidatePairs(places)) {
    const id = pairId(pair.a, pair.b);
    if (existingAuto.has(id)) {
      let current = existingAuto.get(id);
      // Older releases persisted straight-line geometry after a routing
      // failure. Rebuild those records before exposing them as saved paths.
      if (current.metadata?.routingAvailable !== true) {
        let repaired = null;
        try {
          repaired = await routeOnFoot([[pair.aLocation.lat, pair.aLocation.lng], [pair.bLocation.lat, pair.bLocation.lng]], { city, profile: normalizeTransportationMode(pair.a.transportationMode || pair.b.transportationMode || 'walking') === 'cycling' ? 'cycling_beta' : normalizeTransportationMode(pair.a.transportationMode || pair.b.transportationMode || 'walking') === 'driving' ? 'driving_beta' : 'ordinary_walking_beta' });
        } catch { /* keep the record unrouted until the next reconciliation */ }
        if (repaired?.ok && repaired.coordinates?.length >= 2) {
          current = { ...current, coordinates: repaired.coordinates, distanceMeters: Number(repaired.distanceMeters) || current.distanceMeters, durationSeconds: Number(repaired.durationSeconds) || current.durationSeconds, metadata: { ...current.metadata, routingAvailable: true, routingEngine: repaired.routingEngine || null, repairedAt: new Date().toISOString() } };
          current.sections = fallbackSections(current.coordinates, current.distanceMeters);
        } else {
          current = { ...current, coordinates: [], sections: [], metadata: { ...current.metadata, routingAvailable: false, routingFailure: repaired?.status || 'ROUTE_UNAVAILABLE', repairedAt: new Date().toISOString() } };
        }
        await db.put('saved_routes', current);
        state.savedRoutes = [...(state.savedRoutes || []).filter((item) => item.id !== id), current];
      }
      const detours = await buildInterestDetours(current, interests, city);
      const mainSections = ensureAutomaticSections(current);
      const previousDetours = new Map((current.sections || []).filter((section) => section.isDetour && section.discoveryId).map((section) => [section.discoveryId, section]));
      const refreshedDetours = detours.map((detour) => ({ ...detour, enabled: previousDetours.get(detour.discoveryId)?.enabled === true }));
      const corridor = buildRouteCorridor(current);
      const discoveries = routeDiscoveries(current, interests, city, current.experiencedObjectIds || []);
      const memoryPalace = buildMemoryPalaceContext({ route: current, segments: current.sections || [], places, experiences, memories, observations });
      const next = { ...current, interests, corridor, discoveries, memoryPalace, sections: [...mainSections, ...refreshedDetours], updatedAt: new Date().toISOString() };
      if (JSON.stringify(current.sections || []) !== JSON.stringify(next.sections || []) || JSON.stringify(current.interests || []) !== JSON.stringify(interests) || JSON.stringify(current.discoveries || []) !== JSON.stringify(discoveries)) { await db.put('saved_routes', next); state.savedRoutes = [...(state.savedRoutes || []).filter((item) => item.id !== id), next]; generated += 1; }
      continue;
    }
    const transportationMode = normalizeTransportationMode(pair.a.transportationMode || pair.b.transportationMode || 'walking');
    let routed = null;
    try { routed = await routeOnFoot([[pair.aLocation.lat, pair.aLocation.lng], [pair.bLocation.lat, pair.bLocation.lng]], { city, profile: transportationMode === 'cycling' ? 'cycling_beta' : transportationMode === 'driving' ? 'driving_beta' : 'ordinary_walking_beta' }); } catch { routed = null; }
    // Automatic connections must be backed by Valhalla/the installed local
    // routing engine. Never persist a synthetic chord when routing fails: a
    // two-place line would look like a valid path even though it ignores the
    // transport network.
    if (!routed?.ok || !Array.isArray(routed.coordinates) || routed.coordinates.length < 2) continue;
    const coordinates = routed.coordinates;
    const distance = Number(routed.distanceMeters) || pair.distance;
    const route = {
      id, city, title: fallbackTitle(pair.a, pair.b), draft: true, routeMode: 'point-to-point',
      transportationMode,
      color: '#173c35', icon: 'route', notes: 'Automatically generated from logged places.', saved: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      coordinates, distanceMeters: distance, durationSeconds: Number(routed?.durationSeconds) || Math.round(distance / 1.35),
      stops: [
        { id: pair.a.id, name: pair.a.name || 'Logged place', ...pair.aLocation },
        { id: pair.b.id, name: pair.b.name || 'Logged place', ...pair.bLocation }
      ], sections: fallbackSections(coordinates, distance), generatedFrom: 'personal-place-pair',
      sourceLocationIds: [String(pair.a.id), String(pair.b.id)],
      metadata: { automatic: true, routingAvailable: true, routingEngine: routed.routingEngine || null, generatedAt: new Date().toISOString() }, interests,
      corridor: buildRouteCorridor({ id, coordinates, transportationMode }), discoveries: []
    };
    route.memoryPalace = buildMemoryPalaceContext({ route, segments: route.sections, places, experiences, memories, observations });
    route.discoveries = routeDiscoveries(route, interests, city);
    route.sections = [...route.sections, ...(await buildInterestDetours(route, interests, city))];
    await db.put('saved_routes', route);
    state.savedRoutes = [...(state.savedRoutes || []).filter((item) => item.id !== route.id), route];
    generated += 1;
  }
  if (generated) {
    window.dispatchEvent(new CustomEvent('saved-routes-changed', { detail: { automatic: true } }));
    window.dispatchEvent(new CustomEvent('my-walks-reconciled', { detail: { generated } }));
  }
  return { generated, candidates: candidatePairs(places).length };
}

export function installMyWalksReconciler() {
  if (installMyWalksReconciler.installed) return;
  installMyWalksReconciler.installed = true;
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void reconcileMyWalks(); }, 250);
  };
  window.addEventListener('personal-places-changed', schedule);
  window.addEventListener('loader-ready', schedule);
  schedule();
}
