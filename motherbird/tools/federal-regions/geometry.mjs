export function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let positions = 0;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bbox[0] = Math.min(bbox[0], value[0]); bbox[1] = Math.min(bbox[1], value[1]);
      bbox[2] = Math.max(bbox[2], value[0]); bbox[3] = Math.max(bbox[3], value[1]);
      positions += 1;
      return;
    }
    value.forEach(visit);
  };
  visit(geometry?.coordinates);
  if (!positions) throw new Error('Geometry has no valid positions.');
  return bbox;
}

export function simplifyGeometry(geometry, tolerance) {
  if (!geometry || !Number.isFinite(tolerance) || tolerance <= 0) return geometry;
  const simplifyPolygon = (polygon) => polygon.map((ring) => simplifyRing(ring, tolerance));
  if (geometry.type === 'Polygon') return { ...geometry, coordinates: simplifyPolygon(geometry.coordinates) };
  if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map(simplifyPolygon) };
  return geometry;
}

function simplifyRing(ring, tolerance) {
  if (!Array.isArray(ring) || ring.length <= 5) return ring;
  const closed = samePosition(ring[0], ring.at(-1));
  const points = closed ? ring.slice(0, -1) : ring.slice();
  const simplified = douglasPeucker(points, tolerance);
  if (simplified.length < 3) return ring;
  if (closed) simplified.push([...simplified[0]]);
  return simplified.length >= 4 ? simplified : ring;
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const squaredTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = squaredTolerance;
    let selected = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = segmentDistanceSquared(points[index], points[first], points[last]);
      if (distance > farthest) { farthest = distance; selected = index; }
    }
    if (selected >= 0) {
      keep[selected] = 1;
      stack.push([first, selected], [selected, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function segmentDistanceSquared(point, start, end) {
  let x = start[0]; let y = start[1];
  let dx = end[0] - x; let dy = end[1] - y;
  if (dx || dy) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = end[0]; y = end[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = point[0] - x; dy = point[1] - y;
  return dx * dx + dy * dy;
}

const samePosition = (left, right) => left?.[0] === right?.[0] && left?.[1] === right?.[1];
