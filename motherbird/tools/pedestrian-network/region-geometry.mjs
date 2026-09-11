const EPSILON = 1e-10;

export function boundaryGeometry(value) {
  if (value?.type === 'Feature') return value.geometry;
  if (value?.type === 'FeatureCollection') {
    if (value.features?.length !== 1) throw new Error('Region boundary FeatureCollection must contain exactly one feature.');
    return value.features[0].geometry;
  }
  return value;
}

export function validateBoundary(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('Region boundary must be a GeoJSON Polygon or MultiPolygon.');
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons.length) throw new Error('Region boundary has no polygons.');
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('Region boundary contains an empty polygon.');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Every region boundary ring needs at least four positions.');
      for (const position of ring) {
        if (!validPosition(position)) throw new Error('Region boundary contains an invalid longitude/latitude position.');
      }
    }
  }
  return geometry;
}

export function geometryBounds(geometry) {
  const positions = geometry.type === 'Polygon' ? geometry.coordinates.flat(1) : geometry.coordinates.flat(2);
  return [
    Math.min(...positions.map((position) => position[0])),
    Math.min(...positions.map((position) => position[1])),
    Math.max(...positions.map((position) => position[0])),
    Math.max(...positions.map((position) => position[1]))
  ];
}

export function clipFeatureCollection(featureCollection, boundary) {
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new Error('Pedestrian source must be a GeoJSON FeatureCollection.');
  }
  const clipContext = createClipContext(boundary);
  const features = [];
  for (const feature of featureCollection.features) {
    const clipped = clipFeature(feature, boundary, clipContext);
    if (clipped) features.push(clipped);
  }
  return { type: 'FeatureCollection', features };
}

export function clipFeature(feature, boundary, clipContext = null) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Point') return pointInBoundary(geometry.coordinates, boundary) ? feature : null;
  if (geometry.type === 'LineString') {
    const parts = clipLineString(geometry.coordinates, boundary, clipContext);
    return withParts(feature, parts);
  }
  if (geometry.type === 'MultiLineString') {
    const parts = geometry.coordinates.flatMap((line) => clipLineString(line, boundary, clipContext));
    return withParts(feature, parts);
  }
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    // Pedestrian areas are normalized from their boundary rings. This keeps the
    // existing line-only graph contract and retains the original area tag.
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const parts = polygons.flatMap((polygon) => polygon.flatMap((ring) => clipLineString(ring, boundary, clipContext)));
    return withParts(feature, parts, { _mb_area_geometry: geometry.type });
  }
  return null;
}

function withParts(feature, parts, extraProperties = {}) {
  const usable = parts.filter((part) => part.length >= 2 && part.some((position, index) => index && !samePosition(position, part[index - 1])));
  if (!usable.length) return null;
  return {
    ...feature,
    properties: { ...(feature.properties || {}), ...extraProperties },
    geometry: usable.length === 1
      ? { type: 'LineString', coordinates: usable[0] }
      : { type: 'MultiLineString', coordinates: usable }
  };
}

export function clipLineString(coordinates, boundary, clipContext = null) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  // Most municipal centerline records are short and lie well inside their
  // jurisdiction. A cell proven to be fully inside the boundary needs no
  // per-segment polygon intersection work.
  if (clipContext?.containsLine(coordinates)) return [coordinates.map(twoDimensions)];
  const rings = boundaryRings(boundary);
  const parts = [];
  let current = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = twoDimensions(coordinates[index]);
    const end = twoDimensions(coordinates[index + 1]);
    if (!validPosition(start) || !validPosition(end) || samePosition(start, end)) continue;
    const ts = [0, 1];
    for (const ring of rings) {
      for (let ringIndex = 0; ringIndex < ring.length - 1; ringIndex += 1) {
        const t = segmentIntersectionT(start, end, ring[ringIndex], ring[ringIndex + 1]);
        if (t !== null && t > EPSILON && t < 1 - EPSILON) ts.push(t);
      }
    }
    const ordered = [...new Set(ts.map((value) => Math.round(value * 1e12) / 1e12))].sort((left, right) => left - right);
    for (let partIndex = 0; partIndex < ordered.length - 1; partIndex += 1) {
      const t0 = ordered[partIndex];
      const t1 = ordered[partIndex + 1];
      if (!pointInBoundary(interpolate(start, end, (t0 + t1) / 2), boundary)) {
        if (current.length >= 2) parts.push(current);
        current = [];
        continue;
      }
      const clippedStart = interpolate(start, end, t0);
      const clippedEnd = interpolate(start, end, t1);
      if (!current.length || !samePosition(current.at(-1), clippedStart)) {
        if (current.length >= 2) parts.push(current);
        current = [clippedStart];
      }
      if (!samePosition(current.at(-1), clippedEnd)) current.push(clippedEnd);
    }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

function createClipContext(boundary) {
  const cellSize = 0.01;
  const positions = (boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()).flat();
  const minX = Math.floor(Math.min(...positions.map((position) => position[0])) / cellSize) * cellSize;
  const minY = Math.floor(Math.min(...positions.map((position) => position[1])) / cellSize) * cellSize;
  const maxX = Math.max(...positions.map((position) => position[0]));
  const maxY = Math.max(...positions.map((position) => position[1]));
  const segments = boundaryRings(boundary).flatMap((ring) => ring.slice(0, -1).map((start, index) => [start, ring[index + 1]]));
  const segmentCells = new Map();
  for (const segment of segments) {
    const [start, end] = segment;
    const startX = Math.floor((Math.min(start[0], end[0]) - minX) / cellSize);
    const endX = Math.floor((Math.max(start[0], end[0]) - minX) / cellSize);
    const startY = Math.floor((Math.min(start[1], end[1]) - minY) / cellSize);
    const endY = Math.floor((Math.max(start[1], end[1]) - minY) / cellSize);
    for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
      const key = `${x}:${y}`;
      (segmentCells.get(key) || segmentCells.set(key, []).get(key)).push(segment);
    }
  }
  const interior = new Set();
  const width = Math.ceil((maxX - minX) / cellSize);
  const height = Math.ceil((maxY - minY) / cellSize);
  for (let x = 0; x <= width; x += 1) for (let y = 0; y <= height; y += 1) {
    const west = minX + x * cellSize;
    const south = minY + y * cellSize;
    const east = west + cellSize;
    const north = south + cellSize;
    if (!pointInBoundary([(west + east) / 2, (south + north) / 2], boundary)) continue;
    const key = `${x}:${y}`;
    if (!(segmentCells.get(key) || []).some(([start, end]) => segmentTouchesRectangle(start, end, west, south, east, north))) interior.add(key);
  }
  return {
    containsLine(coordinates) {
      let key = null;
      for (const coordinate of coordinates) {
        const position = twoDimensions(coordinate);
        if (!validPosition(position)) return false;
        const x = Math.floor((position[0] - minX) / cellSize);
        const y = Math.floor((position[1] - minY) / cellSize);
        const candidate = `${x}:${y}`;
        if (!interior.has(candidate) || (key && key !== candidate)) return false;
        key = candidate;
      }
      return Boolean(key);
    }
  };
}

function segmentTouchesRectangle(start, end, west, south, east, north) {
  if (Math.max(start[0], end[0]) < west || Math.min(start[0], end[0]) > east || Math.max(start[1], end[1]) < south || Math.min(start[1], end[1]) > north) return false;
  if (start[0] >= west && start[0] <= east && start[1] >= south && start[1] <= north) return true;
  if (end[0] >= west && end[0] <= east && end[1] >= south && end[1] <= north) return true;
  const corners = [[west, south], [east, south], [east, north], [west, north]];
  return corners.some((corner, index) => segmentIntersectionT(start, end, corner, corners[(index + 1) % corners.length]) !== null);
}

export function pointInBoundary(position, boundary) {
  const polygons = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates;
  return polygons.some((polygon) => pointInRing(position, polygon[0]) && !polygon.slice(1).some((ring) => pointInRing(position, ring)));
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (pointOnSegment([x, y], [xi, yi], [xj, yj])) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point, start, end) {
  const cross = (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > EPSILON) return false;
  return point[0] >= Math.min(start[0], end[0]) - EPSILON && point[0] <= Math.max(start[0], end[0]) + EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EPSILON && point[1] <= Math.max(start[1], end[1]) + EPSILON;
}

function segmentIntersectionT(start, end, ringStart, ringEnd) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const rx = ringEnd[0] - ringStart[0];
  const ry = ringEnd[1] - ringStart[1];
  const denominator = dx * ry - dy * rx;
  if (Math.abs(denominator) < EPSILON) return null;
  const qx = ringStart[0] - start[0];
  const qy = ringStart[1] - start[1];
  const t = (qx * ry - qy * rx) / denominator;
  const u = (qx * dy - qy * dx) / denominator;
  return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON ? Math.max(0, Math.min(1, t)) : null;
}

function boundaryRings(boundary) {
  return (boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates).flat();
}

function interpolate(start, end, t) {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

function twoDimensions(position) {
  return [Number(position?.[0]), Number(position?.[1])];
}

function validPosition(position) {
  return Array.isArray(position) && position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1])
    && Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
}

function samePosition(left, right) {
  return Math.abs(left[0] - right[0]) < EPSILON && Math.abs(left[1] - right[1]) < EPSILON;
}
