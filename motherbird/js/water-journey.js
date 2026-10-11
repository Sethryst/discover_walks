import { state } from './state.js';

export const WATER_JOURNEYS_URL = './data/learn/water-journeys.json';
const CROSSING_TOLERANCE_METERS = 35;
let catalogPromise = null;

function finitePoint(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
}

function orientation(a, b, c) {
  return (b.lng - a.lng) * (c.lat - b.lat) - (b.lat - a.lat) * (c.lng - b.lng);
}

function onSegment(a, b, c) {
  return Math.min(a.lat, c.lat) <= b.lat && b.lat <= Math.max(a.lat, c.lat)
    && Math.min(a.lng, c.lng) <= b.lng && b.lng <= Math.max(a.lng, c.lng);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  const epsilon = 1e-10;
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  return (Math.abs(abC) <= epsilon && onSegment(a, c, b)) || (Math.abs(abD) <= epsilon && onSegment(a, d, b))
    || (Math.abs(cdA) <= epsilon && onSegment(c, a, d)) || (Math.abs(cdB) <= epsilon && onSegment(c, b, d));
}

function midpoint(a, b) { return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }; }
function metersPerDegreeLat() { return 111320; }
function metersPerDegreeLng(lat) { return 111320 * Math.cos(Number(lat) * Math.PI / 180); }

function distanceToSegmentMeters(point, a, b) {
  const cos = metersPerDegreeLng(point.lat), px = point.lng * cos, py = point.lat * metersPerDegreeLat();
  const ax = a.lng * cos, ay = a.lat * metersPerDegreeLat(), bx = b.lng * cos, by = b.lat * metersPerDegreeLat();
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceBetweenMeters(a, b) {
  const latScale = metersPerDegreeLat(), lngScale = metersPerDegreeLng((a.lat + b.lat) / 2);
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
}

export async function loadWaterJourneys(fetchImpl = globalThis.fetch) {
  if (!catalogPromise) catalogPromise = Promise.resolve().then(async () => {
    try {
      const response = await fetchImpl(WATER_JOURNEYS_URL);
      if (!response.ok) return { journeys: [] };
      const value = await response.json();
      return { ...value, journeys: Array.isArray(value.journeys) ? value.journeys : [] };
    } catch { return { journeys: [] }; }
  });
  return catalogPromise;
}

export function primeWaterJourneys() { void loadWaterJourneys(); }
export function journeysForCity(journeys, cityId = state.activeCity) {
  const id = String(cityId || '');
  const aliases = new Set([id, id.replace(/-county-va$/, ''), id.replace(/-va$/, '')].filter(Boolean));
  return (journeys || []).filter((journey) => !journey.cityIds?.length || journey.cityIds.some((candidate) => aliases.has(String(candidate))));
}

export function detectWaterCrossings({ previousPoint, point, journeys = [], toleranceMeters = CROSSING_TOLERANCE_METERS } = {}) {
  if (!finitePoint(previousPoint) || !finitePoint(point)) return [];
  const results = [];
  for (const journey of journeys) {
    const line = Array.isArray(journey.streamLine) ? journey.streamLine.map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) })) : [];
    for (let index = 1; index < line.length; index += 1) {
      const from = line[index - 1], to = line[index];
      const intersects = segmentsIntersect(previousPoint, point, from, to);
      const near = distanceToSegmentMeters(previousPoint, from, to) <= toleranceMeters || distanceToSegmentMeters(point, from, to) <= toleranceMeters;
      if (intersects || near) {
        results.push({ journey, location: intersects ? midpoint(previousPoint, point) : (distanceToSegmentMeters(previousPoint, from, to) <= toleranceMeters ? previousPoint : point), segmentIndex: index - 1, confidence: intersects ? 'high' : 'near-line' });
        break;
      }
    }
  }
  return results;
}

export function somethingNewNearby({ journeys = [], encounteredIds = new Set(), point, maxDistanceMeters = 2500 } = {}) {
  if (!finitePoint(point)) return null;
  return journeys.filter((journey) => !encounteredIds.has(String(journey.id))).map((journey) => {
    const access = journey.accessPoints?.[0];
    if (!access) return null;
    return { journey, distanceMeters: distanceBetweenMeters(point, access) };
  }).filter((item) => item && item.distanceMeters <= maxDistanceMeters).sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;
}

export function resetWaterJourneyCache() { catalogPromise = null; }
