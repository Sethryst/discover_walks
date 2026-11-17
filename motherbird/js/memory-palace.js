import { distanceMeters } from './geo.js';

export function buildMemoryPalaceContext({ route = null, segments = [], places = [], experiences = [], memories = [], observations = [] } = {}) {
  const routeCoordinates = route?.coordinates || [];
  const segmentRows = segments.length ? segments : (route ? [{ id: 'main', coordinates: routeCoordinates }] : []);
  const personal = [...places, ...experiences, ...memories, ...observations].filter((item) => validLocation(item.location));
  const linked = segmentRows.map((segment) => ({
    segmentId: String(segment.id || 'main'),
    memories: memories.filter((item) => nearGeometry(item.location, segment.coordinates || routeCoordinates, 120)),
    observations: observations.filter((item) => nearGeometry(item.location, segment.coordinates || routeCoordinates, 120)),
    places: places.filter((item) => nearGeometry(item.location, segment.coordinates || routeCoordinates, 120)),
    experiences: experiences.filter((item) => nearGeometry(item.location, segment.coordinates || routeCoordinates, 120))
  }));
  const linkedItems = linked.flatMap((segment) => [...segment.memories, ...segment.observations, ...segment.places, ...segment.experiences]);
  const linkedIds = new Set(linkedItems.map((item) => String(item.id)).filter(Boolean));
  return { routeId: route?.id ? String(route.id) : null, experiencedObjectIds: [...linkedIds], segments: linked, memoryCount: new Set(linked.flatMap((segment) => segment.memories.map((item) => String(item.id)))).size, observationCount: new Set(linked.flatMap((segment) => segment.observations.map((item) => String(item.id)))).size, placeCount: new Set(linked.flatMap((segment) => segment.places.map((item) => String(item.id)))).size };
}

export function retrieveGeographicMemories({ position, memories = [], observations = [], places = [], radiusMeters = 120 } = {}) {
  if (!validLocation(position)) return [];
  return [...memories.map((item) => ({ ...item, memoryType: 'memory' })), ...observations.map((item) => ({ ...item, memoryType: 'observation' })), ...places.map((item) => ({ ...item, memoryType: 'place' }))]
    .filter((item) => validLocation(item.location))
    .map((item) => ({ ...item, distanceMeters: distanceMeters(position, item.location) }))
    .filter((item) => item.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || String(a.id).localeCompare(String(b.id)));
}

function nearGeometry(location, coordinates = [], radiusMeters) {
  if (!validLocation(location) || !coordinates.length) return false;
  const points = coordinates.map((point) => ({ lat: Number(point[0]), lng: Number(point[1]) }));
  const distances = points.map((point) => distanceMeters(location, point));
  for (let index = 1; index < points.length; index += 1) distances.push(pointSegmentDistance(location, points[index - 1], points[index]));
  return Math.min(...distances) <= radiusMeters;
}
function pointSegmentDistance(point, a, b) { const scale = Math.cos(((point.lat + a.lat + b.lat) / 3) * Math.PI / 180); const project = (item) => ({ x: item.lng * scale * 111320, y: item.lat * 110540 }); const p = project(point), start = project(a), end = project(b); const dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy; const t = length ? Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / length)) : 0; return Math.hypot(p.x - (start.x + t * dx), p.y - (start.y + t * dy)); }
function validLocation(location) { return Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lng)); }

export const memoryPalaceTestHelpers = { nearGeometry, validLocation };
