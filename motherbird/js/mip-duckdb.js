const DUCKDB_VERSION = '1.32.0';
const DUCKDB_ROOT = new URL(`../vendor/duckdb-wasm/${DUCKDB_VERSION}/`, import.meta.url);
const MAX_ROUTE_SAMPLES = 180;
const MAX_POIS = 1000;

let databasePromise = null;
let queryQueue = Promise.resolve();

/**
 * Query locally installed places against a locally calculated route. The
 * DuckDB runtime, worker, WASM binary, route geometry, and POI rows all stay
 * in this browser. No extension is loaded because extensions may fetch code.
 */
export function queryRouteCorridor({ coordinates = [], pois = [], corridorMeters = 900, limit = 24 } = {}) {
  const task = queryQueue.then(() => queryRouteCorridorNow({ coordinates, pois, corridorMeters, limit }));
  queryQueue = task.catch(() => undefined);
  return task;
}

async function queryRouteCorridorNow({ coordinates, pois, corridorMeters, limit }) {
  const route = sampleRoute(coordinates);
  const candidates = normalizePois(pois, route, corridorMeters);
  if (route.length < 2 || !candidates.length) return { engine: 'duckdb-wasm', matches: [] };
  try {
    const db = await getDatabase();
    const connection = await db.connect();
    try {
      const result = await connection.query(buildCorridorSql(route, candidates, corridorMeters, limit));
      const matches = result.toArray().map((row) => {
        const value = typeof row?.toJSON === 'function' ? row.toJSON() : row;
        const candidate = candidates[Number(value.poi_index)];
        return candidate ? { ...candidate.source, corridorDistanceMeters: Math.round(Number(value.corridor_distance_m)), interestScore: candidate.interestScore } : null;
      }).filter(Boolean);
      return { engine: 'duckdb-wasm', matches };
    } finally {
      await connection.close();
    }
  } catch (error) {
    // A browser that cannot start WASM still gets a bounded, device-only
    // geometric result. The engine label makes the qualification observable.
    return { engine: 'local-geometric-fallback', matches: geometricFallback(route, candidates, corridorMeters, limit), warning: error?.message || 'DuckDB-Wasm unavailable.' };
  }
}

async function getDatabase() {
  if (!databasePromise) databasePromise = initializeDatabase().catch((error) => { databasePromise = null; throw error; });
  return databasePromise;
}

async function initializeDatabase() {
  const duckdb = await import(new URL('duckdb-browser.bundle.mjs?v=20261104-1', DUCKDB_ROOT));
  const workerUrl = new URL('duckdb-browser-mvp.worker.js?v=20261104-1', DUCKDB_ROOT);
  const wasmUrl = new URL('duckdb-mvp.wasm?v=20261104-1', DUCKDB_ROOT);
  const worker = await duckdb.createWorker(workerUrl);
  const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await database.instantiate(wasmUrl.href);
    return database;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

export function sampleRoute(coordinates = [], maximum = MAX_ROUTE_SAMPLES) {
  const valid = coordinates.map(normalizeCoordinate).filter(Boolean);
  if (valid.length <= maximum) return valid;
  const sampled = [];
  const step = (valid.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) sampled.push(valid[Math.round(index * step)]);
  return sampled;
}

function normalizePois(pois, route, corridorMeters) {
  if (!route.length) return [];
  const latitudePadding = Number(corridorMeters) / 110540;
  const averageLatitude = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
  const longitudePadding = Number(corridorMeters) / Math.max(1000, 111320 * Math.cos(averageLatitude * Math.PI / 180));
  const minLat = Math.min(...route.map((point) => point.lat)) - latitudePadding;
  const maxLat = Math.max(...route.map((point) => point.lat)) + latitudePadding;
  const minLng = Math.min(...route.map((point) => point.lng)) - longitudePadding;
  const maxLng = Math.max(...route.map((point) => point.lng)) + longitudePadding;
  return (pois || []).map((source) => {
    const point = normalizeCoordinate(source);
    if (!point || point.lat < minLat || point.lat > maxLat || point.lng < minLng || point.lng > maxLng) return null;
    return { source, ...point, interestScore: scoreInterest(source) };
  }).filter(Boolean).slice(0, MAX_POIS);
}

function buildCorridorSql(route, candidates, corridorMeters, limit) {
  const poiValues = candidates.map((poi, index) => `(${index},${sqlNumber(poi.lat)},${sqlNumber(poi.lng)},${sqlNumber(poi.interestScore)})`).join(',');
  const sampleValues = route.map((point) => `(${sqlNumber(point.lat)},${sqlNumber(point.lng)})`).join(',');
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 24)));
  const safeCorridor = Math.max(25, Math.min(20000, Number(corridorMeters) || 900));
  return `
    WITH pois(poi_index, lat, lng, interest_score) AS (VALUES ${poiValues}),
         route_samples(lat, lng) AS (VALUES ${sampleValues}),
         distances AS (
           SELECT p.poi_index, p.interest_score,
             MIN(111320 * SQRT(POW(p.lat - s.lat, 2) + POW((p.lng - s.lng) * COS(RADIANS((p.lat + s.lat) / 2)), 2))) AS corridor_distance_m
           FROM pois p CROSS JOIN route_samples s
           GROUP BY p.poi_index, p.interest_score
         )
    SELECT poi_index, corridor_distance_m
    FROM distances
    WHERE corridor_distance_m <= ${sqlNumber(safeCorridor)}
    ORDER BY interest_score DESC, corridor_distance_m ASC, poi_index ASC
    LIMIT ${safeLimit}`;
}

function geometricFallback(route, candidates, corridorMeters, limit) {
  return candidates.map((candidate) => ({ candidate, distance: Math.min(...route.map((point) => distanceMeters(candidate, point))) }))
    .filter((entry) => entry.distance <= corridorMeters)
    .sort((left, right) => right.candidate.interestScore - left.candidate.interestScore || left.distance - right.distance)
    .slice(0, Math.max(1, Number(limit) || 24))
    .map(({ candidate, distance }) => ({ ...candidate.source, corridorDistanceMeters: Math.round(distance), interestScore: candidate.interestScore }));
}

function scoreInterest(place) {
  const text = `${place?.category || ''} ${(place?.tags || []).join(' ')} ${(place?.facts || []).join(' ')}`.toLowerCase();
  let score = 1;
  if (/historic|heritage|architecture|museum|monument|landmark/.test(text)) score += 2;
  if (/park|garden|trail|nature|wildlife|river|stream|wetland|forest/.test(text)) score += 2;
  if (place?.saved || place?.source === 'personal') score += 1;
  if (place?.visited === false || place?.visitCount === 0) score += 0.5;
  return score;
}

function normalizeCoordinate(value) {
  const lat = Number(value?.lat ?? value?.latitude ?? value?.location?.lat ?? (Array.isArray(value) ? value[1] : NaN));
  const lng = Number(value?.lng ?? value?.lon ?? value?.longitude ?? value?.location?.lng ?? (Array.isArray(value) ? value[0] : NaN));
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function distanceMeters(left, right) {
  const dy = (left.lat - right.lat) * 110540;
  const dx = (left.lng - right.lng) * 111320 * Math.cos(((left.lat + right.lat) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

function sqlNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('MIP query contains a non-finite coordinate.');
  return String(number);
}

