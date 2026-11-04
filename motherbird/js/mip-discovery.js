import { queryRouteCorridor } from './mip-duckdb.js?v=20261104-duckdb-mip-1';

const MODE_PROFILES = Object.freeze({ walking: 'ordinary_walking_beta', cycling: 'cycling_beta', driving: 'driving_beta' });
const MODE_CORRIDORS = Object.freeze({ walking: 700, cycling: 1200, driving: 2400 });
const MODE_MAX_EXTRA_MINUTES = Object.freeze({ walking: 12, cycling: 10, driving: 8 });

/** Find a useful waypoint near a route, then verify its detour with the same
 * local router. A place cannot be suggested merely because it is nearby. */
export async function findInterestingDetour({ points = [], directRoute = null, pois = [], travelMode = 'walking', city = null, routeProvider, existingPlaceIds = [], corridorQuery = queryRouteCorridor } = {}) {
  if (typeof routeProvider !== 'function' || points.length < 2) return null;
  const profile = MODE_PROFILES[travelMode] || MODE_PROFILES.walking;
  const direct = directRoute?.ok ? directRoute : await safeRoute(routeProvider, points, profile, city);
  if (!direct?.ok || !Array.isArray(direct.coordinates) || direct.coordinates.length < 2) return null;
  const existing = new Set(existingPlaceIds.map(String));
  const available = pois.filter((place) => !existing.has(String(place?.id)));
  const corridor = await corridorQuery({ coordinates: direct.coordinates, pois: available, corridorMeters: MODE_CORRIDORS[travelMode] || MODE_CORRIDORS.walking, limit: 12 });
  const directSeconds = Number(direct.durationSeconds || 0);
  const maxExtraMinutes = MODE_MAX_EXTRA_MINUTES[travelMode] || MODE_MAX_EXTRA_MINUTES.walking;
  let best = null;
  for (const place of (corridor.matches || []).slice(0, 6)) {
    const waypoint = normalizePlace(place);
    if (!waypoint) continue;
    const routed = await safeRoute(routeProvider, insertWaypoint(points, waypoint), profile, city);
    if (!routed?.ok) continue;
    const extraMinutes = Math.max(0, (Number(routed.durationSeconds || 0) - directSeconds) / 60);
    if (extraMinutes > maxExtraMinutes) continue;
    const candidate = { place: waypoint, route: routed, extraMinutes, corridorDistanceMeters: Number(place.corridorDistanceMeters || 0), interestScore: Number(place.interestScore || 0), queryEngine: corridor.engine };
    if (!best || compareCandidate(candidate, best) < 0) best = candidate;
  }
  if (!best) return null;
  const roundedMinutes = Math.max(0, Math.round(best.extraMinutes));
  const category = best.place.category || (best.place.tags || [])[0] || 'local place';
  return {
    ...best.place,
    mip: { route: best.route, extraMinutes: best.extraMinutes, corridorDistanceMeters: best.corridorDistanceMeters, queryEngine: best.queryEngine },
    explanation: `${category} along this route · about ${roundedMinutes} extra minute${roundedMinutes === 1 ? '' : 's'} · found with local ${best.queryEngine === 'duckdb-wasm' ? 'DuckDB-Wasm' : 'geospatial'} analysis and verified by the on-device router.`
  };
}

function insertWaypoint(points, waypoint) {
  const result = [...points];
  result.splice(Math.max(1, result.length - 1), 0, waypoint);
  return result;
}

async function safeRoute(routeProvider, points, profile, city) {
  try { return await routeProvider(points, { profile, city }) || { ok: false }; } catch { return { ok: false }; }
}

function normalizePlace(place) {
  const lat = Number(place?.lat ?? place?.location?.lat);
  const lng = Number(place?.lng ?? place?.lon ?? place?.location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { ...place, lat, lng } : null;
}

function compareCandidate(left, right) {
  const leftScore = left.extraMinutes * 2 + left.corridorDistanceMeters / 1000 - left.interestScore;
  const rightScore = right.extraMinutes * 2 + right.corridorDistanceMeters / 1000 - right.interestScore;
  return leftScore - rightScore || String(left.place.id || left.place.name).localeCompare(String(right.place.id || right.place.name));
}

