/**
 * Build a non-rendering snapshot of the verified route network around a user's
 * automatic places and selected stops. This module deliberately does not
 * create POIs or synthesize straight-line route geometry.
 */

function pointOf(value) {
  const location = value?.location || value;
  const lat = Number(location?.lat ?? location?.latitude);
  const lng = Number(location?.lng ?? location?.lon ?? location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

function pointKey(point) { return `${point.lat.toFixed(6)}|${point.lng.toFixed(6)}`; }

export function collectSnapshotPoints({ automaticUserPoints = [], selectedStops = [] } = {}) {
  const points = [];
  const seen = new Set();
  for (const [kind, records] of [['automatic', automaticUserPoints], ['selected', selectedStops]]) {
    for (const record of records || []) {
      const location = pointOf(record);
      if (!location) continue;
      const key = pointKey(location);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ ...location, id: record.id || null, name: record.name || record.title || null, kind, source: record });
    }
  }
  return points;
}

function routeCoordinates(route) {
  const coordinates = route?.coordinates || route?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  return coordinates.filter((pair) => Array.isArray(pair) && pair.length >= 2 && Number.isFinite(Number(pair[0])) && Number.isFinite(Number(pair[1])))
    .map(([lat, lng]) => [Number(lat), Number(lng)]);
}

/** Route every adjacent pair. A failed leg is retained as a typed gap. */
export async function connectSnapshotPoints(points = [], { routeOnFoot, routeOptions = {} } = {}) {
  if (typeof routeOnFoot !== 'function') throw new TypeError('connectSnapshotPoints requires routeOnFoot.');
  const legs = [];
  for (let index = 0; index < Math.max(0, points.length - 1); index += 1) {
    const from = points[index], to = points[index + 1];
    let result;
    try { result = await routeOnFoot([from, to], routeOptions); }
    catch (error) { result = { ok: false, status: 'ROUTING_WORKER_ERROR', failure: { message: error?.message || 'Routing failed.' } }; }
    const coordinates = routeCoordinates(result);
    const verified = Boolean(result?.ok && coordinates.length >= 2);
    legs.push({
      index, fromId: from.id, toId: to.id, from, to, ok: verified,
      coordinates: verified ? coordinates : [],
      result: verified ? result : { ...result, ok: false },
      transportationMode: result?.transportationMode || (result?.drivingFallback ? 'driving' : 'walking'),
      drivingFallback: Boolean(result?.drivingFallback || result?.routing_fallback === 'driving')
    });
  }
  return legs;
}

function cross(a, b, c) { return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); }

function convexHull(points) {
  const unique = [...new Map(points.map(([lat, lng]) => [`${lat}|${lng}`, [lng, lat]])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length < 3) return unique.length ? [...unique, unique[0]] : [];
  const lower = [];
  for (const point of unique) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  const upper = [];
  for (const point of [...unique].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1), lower[0]];
}

export function deriveCoverageArea(legs = []) {
  const lines = legs.filter((leg) => leg.ok).map((leg) => leg.coordinates);
  const vertices = lines.flat();
  const ring = convexHull(vertices);
  return { type: 'Polygon', coordinates: ring.length >= 4 ? [ring] : [], invisible: true, source: 'verified-route-lines', lineCount: lines.length };
}

function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point.lat) !== (yj > point.lat) && point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}

function outlinkValues(poi) { return [poi?.sourceUrl, poi?.url, ...(Array.isArray(poi?.outlinks) ? poi.outlinks : []), ...(Array.isArray(poi?.links) ? poi.links : [])].filter((value) => /^https?:\/\//i.test(String(value))); }

export function summarizeSnapshotPois(pois = [], coverageArea = { coordinates: [] }) {
  const ring = coverageArea.coordinates?.[0] || [];
  const insidePois = pois.filter((poi) => { const point = pointOf(poi); return point && ring.length >= 3 && inside(point, ring); });
  const categories = {};
  const domains = {};
  let outlinkCount = 0;
  for (const poi of insidePois) {
    const category = String(poi.category || poi.light || poi.dataKind || 'uncategorized');
    categories[category] = (categories[category] || 0) + 1;
    for (const link of outlinkValues(poi)) { outlinkCount += 1; try { const domain = new URL(link).hostname; domains[domain] = (domains[domain] || 0) + 1; } catch { /* filtered URLs are still counted only when valid */ } }
  }
  return { poiCount: insidePois.length, categories, outlinkCount, outlinkDomains: domains, poiIds: insidePois.map((poi) => poi.id).filter(Boolean) };
}

export async function buildConnectedAreaSnapshot({ automaticUserPoints = [], selectedStops = [], pois = [], routeOnFoot, routeOptions = {}, now = new Date().toISOString() } = {}) {
  const points = collectSnapshotPoints({ automaticUserPoints, selectedStops });
  const legs = await connectSnapshotPoints(points, { routeOnFoot, routeOptions });
  const verifiedLegs = legs.filter((leg) => leg.ok);
  const coverageArea = deriveCoverageArea(verifiedLegs);
  const poiSummary = summarizeSnapshotPois(pois, coverageArea);
  return {
    schema: 'connected-area-snapshot-v1', createdAt: now, points, legs, coverageArea, poiSummary,
    connected: points.length > 0 && legs.length === verifiedLegs.length && verifiedLegs.length === Math.max(0, points.length - 1),
    routeSummary: { legCount: legs.length, verifiedLegCount: verifiedLegs.length, walkingLegCount: verifiedLegs.filter((leg) => leg.transportationMode === 'walking').length, drivingFallbackLegCount: verifiedLegs.filter((leg) => leg.drivingFallback).length }
  };
}

