import { distanceMeters } from './geo.js';

export const TRANSPORTATION_MODES = Object.freeze(['driving', 'walking', 'cycling', 'transit', 'other']);

export const INTEREST_DEFINITIONS = Object.freeze({
  nature: { label: 'Nature', tags: ['park', 'forest', 'garden', 'nature', 'trail', 'greenway'] },
  wildlife: { label: 'Wildlife', tags: ['wildlife', 'bird', 'habitat', 'wetland', 'nature', 'water'] },
  history: { label: 'History', tags: ['history', 'historic', 'heritage', 'landmark', 'museum', 'bridge'] },
  water: { label: 'Water', tags: ['water', 'river', 'stream', 'lake', 'wetland', 'shoreline'] },
  architecture: { label: 'Architecture', tags: ['architecture', 'building', 'historic', 'industrial'] },
  food: { label: 'Food and drink', tags: ['coffee', 'cafe', 'bakery', 'restaurant', 'market', 'food'] },
  neighborhoods: { label: 'Neighborhoods', tags: ['neighborhood', 'commercial', 'residential', 'district'] },
  geology: { label: 'Geology', tags: ['geology', 'landform', 'rock', 'terrain', 'elevation'] },
  art: { label: 'Public art', tags: ['art', 'mural', 'sculpture', 'installation'] },
  quiet: { label: 'Quiet places', tags: ['quiet', 'greenway', 'park', 'buffer', 'secluded'] },
  gardens: { label: 'Gardens', tags: ['garden', 'botanical', 'landscaped', 'community_garden'] },
  unusual: { label: 'Unusual places', tags: ['unusual', 'distinctive', 'feature', 'cultural'] }
});

const MODE_CORRIDOR_METERS = Object.freeze({ driving: 2400, walking: 700, cycling: 1200, transit: 1800, other: 1200 });

export function normalizeTransportationMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return TRANSPORTATION_MODES.includes(mode) ? mode : 'other';
}

export function corridorRadiusFor(mode, override = null) {
  const radius = Number(override);
  return Number.isFinite(radius) && radius > 0 ? Math.max(25, Math.min(20000, radius)) : MODE_CORRIDOR_METERS[normalizeTransportationMode(mode)];
}

export function buildRouteCorridor(route = {}, { corridorMeters = null } = {}) {
  const coordinates = (route.coordinates || route.geometry || []).map(normalizeCoordinate).filter(Boolean);
  const transportationMode = normalizeTransportationMode(route.transportationMode || route.travelMode || (route.routeMode === 'driving' ? 'driving' : route.routeMode === 'cycling' ? 'cycling' : 'walking'));
  const radiusMeters = corridorRadiusFor(transportationMode, corridorMeters);
  const bounds = coordinates.reduce((box, point) => ({ south: Math.min(box.south, point.lat), west: Math.min(box.west, point.lng), north: Math.max(box.north, point.lat), east: Math.max(box.east, point.lng) }), { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity });
  return { id: String(route.id || ''), coordinates, transportationMode, radiusMeters, bounds, geometryType: 'LineString', provenance: { source: 'route-geometry', routeId: String(route.id || ''), transportationMode } };
}

export function interestTags(interests = []) {
  return [...new Set(interests.flatMap((interest) => INTEREST_DEFINITIONS[String(interest).toLowerCase()]?.tags || [String(interest).toLowerCase()]).filter(Boolean))];
}

export function tagsForObject(object = {}) {
  return [...new Set([object.category, object.categoryId, object.chipId, object.kind, ...(object.tags || []), ...(object.domains || [])].filter(Boolean).flatMap((tag) => String(tag).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)))];
}

export function interestMatch(object, interests = []) {
  const tags = tagsForObject(object);
  const selected = [...new Set(interests.map((interest) => String(interest).toLowerCase()))];
  const matches = selected.filter((interest) => (INTEREST_DEFINITIONS[interest]?.tags || [interest]).some((tag) => tags.includes(tag)));
  return { matches, tags, score: matches.length / Math.max(1, selected.length) };
}

export function spatialRelationship(left, right, { nearMeters = 250 } = {}) {
  const leftGeometry = geometryOf(left), rightGeometry = geometryOf(right);
  if (!leftGeometry.length || !rightGeometry.length) return { type: 'unknown', distanceMeters: null };
  const distance = geometryDistance(leftGeometry, rightGeometry);
  if (distance === 0 || samePoint(leftGeometry[0], rightGeometry[0])) return { type: 'overlaps', distanceMeters: 0 };
  if (distance <= nearMeters) return { type: 'near', distanceMeters: distance };
  return { type: 'separate', distanceMeters: distance };
}

export function analyzeSpatialRelationships(objects = [], options = {}) {
  const relationships = [];
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
      const relationship = spatialRelationship(objects[leftIndex], objects[rightIndex], options);
      if (relationship.type !== 'unknown') relationships.push({ leftId: String(objects[leftIndex].id || leftIndex), rightId: String(objects[rightIndex].id || rightIndex), ...relationship });
    }
  }
  return relationships;
}

export function clusterGeographicObjects(objects = [], { nearMeters = 250, minimumSize = 1 } = {}) {
  const parents = objects.map((_, index) => index);
  const find = (index) => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  const join = (left, right) => { const leftRoot = find(left), rightRoot = find(right); if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot; };
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
    const relationship = spatialRelationship(objects[leftIndex], objects[rightIndex], { nearMeters });
    if (relationship.type === 'near' || relationship.type === 'overlaps') join(leftIndex, rightIndex);
  }
  const groups = new Map();
  objects.forEach((object, index) => { const root = find(index); const group = groups.get(root) || []; group.push(object); groups.set(root, group); });
  return [...groups.values()].filter((group) => group.length >= Math.max(1, minimumSize)).map((members, index) => ({ id: `cluster:${index + 1}`, size: members.length, members }));
}

export function buildDiscoveryOpportunities({ route, objects = [], interests = [], exploredIds = [], corridorMeters = null } = {}) {
  const corridor = buildRouteCorridor(route, { corridorMeters });
  const explored = new Set(exploredIds.map(String));
  const opportunities = objects.map((object) => {
    const match = interestMatch(object, interests);
    const relation = routeDistance(object, corridor.coordinates);
    if (!match.matches.length || !Number.isFinite(relation) || relation > corridor.radiusMeters) return null;
    const unexplored = !explored.has(String(object.id));
    const labels = match.matches.map((interest) => INTEREST_DEFINITIONS[interest]?.label || interest);
    return {
      id: `discovery:${object.id || `${object.lat}:${object.lng}`}`,
      object,
      relatedRouteId: corridor.id,
      transportationMode: corridor.transportationMode,
      relationship: relation === 0 ? 'along route' : 'near route',
      corridorDistanceMeters: Math.round(relation),
      interests: match.matches,
      unexplored,
      score: match.score + (unexplored ? 0.25 : 0),
      explanation: `${unexplored ? 'Unexplored ' : ''}${labels.join(' + ')} opportunity ${relation <= 25 ? 'along' : 'near'} a route you travel by ${corridor.transportationMode}.`
    };
  }).filter(Boolean);
  return opportunities.sort((a, b) => b.score - a.score || a.corridorDistanceMeters - b.corridorDistanceMeters || a.id.localeCompare(b.id));
}

function routeDistance(object, coordinates) {
  const point = normalizeCoordinate(object);
  if (point && coordinates.length >= 2) return Math.min(...coordinates.slice(1).map((end, index) => pointSegmentDistance(point, coordinates[index], end)));
  const geometry = geometryOf(object);
  if (!geometry.length || coordinates.length < 2) return Infinity;
  return Math.min(...geometry.map((item) => routeDistance(item, coordinates)));
}

function geometryOf(object) {
  const point = normalizeCoordinate(object);
  if (point) return [point];
  const coordinates = object?.geometry?.coordinates || object?.coordinates;
  return flattenCoordinates(coordinates).map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function flattenCoordinates(value) { return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])) ? [value] : Array.isArray(value) ? value.flatMap(flattenCoordinates) : []; }
function normalizeCoordinate(value) { const lat = Number(value?.lat ?? value?.location?.lat ?? (Array.isArray(value) ? value[0] : NaN)); const lng = Number(value?.lng ?? value?.lon ?? value?.location?.lng ?? (Array.isArray(value) ? value[1] : NaN)); return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null; }
function samePoint(a, b) { return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7; }
function geometryDistance(left, right) {
  let minimum = Infinity;
  for (const a of left) for (const b of right) minimum = Math.min(minimum, distanceMeters(a, b));
  const nearestToLine = (points, line) => points.map((point) => Math.min(...line.slice(1).map((end, index) => pointSegmentDistance(point, line[index], end))));
  if (left.length > 1) minimum = Math.min(minimum, ...nearestToLine(right, left));
  if (right.length > 1) minimum = Math.min(minimum, ...nearestToLine(left, right));
  return minimum;
}
function pointSegmentDistance(point, a, b) { const scale = Math.cos(((point.lat + a.lat + b.lat) / 3) * Math.PI / 180); const project = (item) => ({ x: item.lng * scale * 111320, y: item.lat * 110540 }); const p = project(point), start = project(a), end = project(b); const dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy; const t = length ? Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / length)) : 0; return Math.hypot(p.x - (start.x + t * dx), p.y - (start.y + t * dy)); }

export const routeIntelligenceTestHelpers = { geometryOf, pointSegmentDistance };
