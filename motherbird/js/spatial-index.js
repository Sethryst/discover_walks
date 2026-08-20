const DEFAULT_CELL_DEGREES = 0.01;
const METERS_PER_DEGREE = 111_320;

export class SpatialGridIndex {
  constructor(cellDegrees = DEFAULT_CELL_DEGREES) { this.cellDegrees = cellDegrees; this.cells = new Map(); }
  insert(item) { const key = this.key(item.lat, item.lng); if (!this.cells.has(key)) this.cells.set(key, []); this.cells.get(key).push(item); }
  queryBbox(west, south, east, north) {
    const found = new Map();
    const minX = Math.floor(west / this.cellDegrees); const maxX = Math.floor(east / this.cellDegrees);
    const minY = Math.floor(south / this.cellDegrees); const maxY = Math.floor(north / this.cellDegrees);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) (this.cells.get(`${x}:${y}`) || []).forEach((item) => found.set(item.id, item));
    return [...found.values()];
  }
  key(lat, lng) { return `${Math.floor(lng / this.cellDegrees)}:${Math.floor(lat / this.cellDegrees)}`; }
}

let active = { cityId: null, index: new SpatialGridIndex(), neighborhoods: new Map() };

export function reindexSpatialData(cityId, pois = [], neighborhoodGeojson = null) {
  const index = new SpatialGridIndex();
  pois.filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng)).forEach((poi) => index.insert(poi));
  const neighborhoods = new Map((neighborhoodGeojson?.features || []).map((feature) => [feature.properties?.id || feature.id, feature]));
  active = { cityId, index, neighborhoods };
  return { cityId, poiCount: pois.length, neighborhoodCount: neighborhoods.size };
}

export function getPoisNearRoute(latlngs, radiusMeters = 120) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) return [];
  const route = latlngs.map(toPoint).filter(Boolean);
  if (route.length < 2) return [];
  const latitude = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
  const latPad = radiusMeters / METERS_PER_DEGREE;
  const lngPad = radiusMeters / (METERS_PER_DEGREE * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  const candidates = new Map();
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1]; const b = route[i];
    active.index.queryBbox(Math.min(a.lng, b.lng) - lngPad, Math.min(a.lat, b.lat) - latPad, Math.max(a.lng, b.lng) + lngPad, Math.max(a.lat, b.lat) + latPad).forEach((poi) => candidates.set(poi.id, poi));
  }
  return [...candidates.values()].map((poi) => ({ poi, distanceMeters: routeDistance(poi, route) })).filter((result) => result.distanceMeters <= radiusMeters).sort((a, b) => a.distanceMeters - b.distanceMeters || String(a.poi.id).localeCompare(String(b.poi.id)));
}

export function getPoisInNeighborhood(neighborhoodId) {
  const feature = active.neighborhoods.get(neighborhoodId);
  if (!feature) return [];
  const [west, south, east, north] = geometryBbox(feature.geometry);
  return active.index.queryBbox(west, south, east, north).filter((poi) => pointInGeometry([poi.lng, poi.lat], feature.geometry)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function spatialIndexStatus() { return { cityId: active.cityId, cells: active.index.cells.size, neighborhoods: active.neighborhoods.size }; }

function toPoint(value) { if (Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1])) return { lat: value[0], lng: value[1] }; if (Number.isFinite(value?.lat) && Number.isFinite(value?.lng)) return value; return null; }
function routeDistance(point, route) { let minimum = Infinity; for (let i = 1; i < route.length; i += 1) minimum = Math.min(minimum, pointSegmentDistance(point, route[i - 1], route[i])); return minimum; }
function pointSegmentDistance(point, a, b) {
  const referenceLat = (point.lat + a.lat + b.lat) / 3 * Math.PI / 180;
  const project = (item) => ({ x: item.lng * Math.cos(referenceLat) * METERS_PER_DEGREE, y: item.lat * METERS_PER_DEGREE });
  const p = project(point); const start = project(a); const end = project(b); const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - (start.x + t * dx), p.y - (start.y + t * dy));
}
function geometryBbox(geometry) { return positions(geometry?.coordinates).reduce((bbox, [lng, lat]) => [Math.min(bbox[0], lng), Math.min(bbox[1], lat), Math.max(bbox[2], lng), Math.max(bbox[3], lat)], [Infinity, Infinity, -Infinity, -Infinity]); }
function positions(value) { if (Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) return [value]; return Array.isArray(value) ? value.flatMap(positions) : []; }
function pointInGeometry(point, geometry) { const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []; return polygons.some((rings) => pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole))); }
function pointInRing([x, y], ring = []) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside; } return inside; }

export const spatialTestHelpers = { pointInGeometry, pointSegmentDistance };
