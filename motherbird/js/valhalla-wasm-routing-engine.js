import { Router } from '../vendor/valhalla-browser/0.2.1/index.js';
import { resolveInstalledValhallaManifest } from './valhalla-package-store.js?v=20261104-valhalla-offline-1';

const WORKER_URL = new URL('../vendor/valhalla-browser/0.2.1/worker.js', import.meta.url);
const WASM_URL = new URL('../vendor/valhalla-browser/0.2.1/valhalla-browser.wasm', import.meta.url);
const DEFAULT_MEMORY_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * Valhalla 3.8.3 running in a browser Web Worker through WebAssembly.
 *
 * A regional package supplies a static Valhalla manifest and graph tiles. The
 * SDK may fetch those immutable files, but precise route coordinates are sent
 * only to the worker and never appear in a network request.
 */
export function createValhallaWasmRoutingEngine({
  RouterClass = Router,
  workerUrl = WORKER_URL,
  wasmUrl = WASM_URL,
  memoryBudgetBytes = DEFAULT_MEMORY_BUDGET_BYTES,
  wasmMemory = { initialMiB: 64, maximumMiB: 256 },
  searchMemory = { astar: 8192, bidirectionalAstar: 8192, clearReservedMemory: true }
} = {}) {
  const routers = new Map();

  return Object.freeze({
    id: 'valhalla-wasm',
    label: 'Valhalla WebAssembly',
    localOnly: true,
    execution: 'device',
    graphFormat: 'valhalla-tile-set',
    profiles: ['driving', 'walking', 'cycling'],
    async routeLeg(payload) {
      const sourceManifestUrl = payload?.cell?.artifacts?.valhalla_manifest?.url;
      if (!sourceManifestUrl) return failure('GRAPH_VERSION_UNAVAILABLE', 'The regional package has no Valhalla manifest.');

      const installed = await resolveInstalledValhallaManifest(sourceManifestUrl);
      const canUseOfflineCopy = installed && (!globalThis.navigator?.serviceWorker || globalThis.navigator.serviceWorker.controller);
      const manifestUrl = canUseOfflineCopy ? installed.localManifestUrl : sourceManifestUrl;
      const transport = canUseOfflineCopy ? installed.transport : payload.cell.artifacts.valhalla_manifest.transport || 'indexed-tar';
      const key = `${transport}:${manifestUrl}`;
      let router = routers.get(key);
      if (!router) {
        router = new RouterClass({
          manifestUrl,
          transport,
          memoryBudgetBytes,
          wasmMemory,
          searchMemory,
          timeoutMs: 20_000,
          retries: 1,
          workerUrl,
          wasmUrl
        });
        routers.set(key, router);
      }

      try {
        const costing = mapProfile(payload.profile);
        const result = await router.route({
          origin: toValhallaCoordinate(payload.origin),
          destination: toValhallaCoordinate(payload.destination),
          costing,
          ...costingOptions(costing, payload.costingOptions)
        });
        return normalize(result, payload.cell, costing, Boolean(payload.avoidEdges?.length));
      } catch (error) {
        return failure(mapRoutingError(error?.code), error?.message || String(error), error?.code || null);
      }
    },
    async dispose() {
      await Promise.allSettled([...routers.values()].map((router) => router.dispose?.()));
      routers.clear();
    }
  });
}

export const valhallaWasmRoutingEngine = createValhallaWasmRoutingEngine();

function toValhallaCoordinate(point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lng ?? point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new TypeError('Valhalla route coordinates are invalid.');
  return { lat, lon };
}

function mapProfile(profile) {
  const normalized = String(profile || 'walking').toLowerCase();
  if (['walking', 'pedestrian', 'ordinary_walking_beta', 'accessible_verified'].includes(normalized)) return 'pedestrian';
  if (['driving', 'driving_beta', 'drive', 'auto', 'car'].includes(normalized)) return 'auto';
  if (['cycling', 'cycling_beta', 'cycle', 'bicycle', 'bike'].includes(normalized)) return 'bicycle';
  throw Object.assign(new Error(`Unsupported local routing profile: ${profile}`), { code: 'UNSUPPORTED_COSTING' });
}

function costingOptions(costing, options) {
  if (!options || typeof options !== 'object') return {};
  if (costing === 'pedestrian' && options.walking_speed != null) {
    return { costing_options: { pedestrian: { walking_speed: Number(options.walking_speed) } } };
  }
  if (costing === 'bicycle') {
    const bicycle = Object.fromEntries(['bicycle_type', 'cycling_speed', 'use_roads']
      .filter((key) => options[key] != null).map((key) => [key, options[key]]));
    return Object.keys(bicycle).length ? { costing_options: { bicycle } } : {};
  }
  return {};
}

function normalize(result, cell, costing, avoidedEdgesRequested) {
  const trip = result?.native?.trip;
  const legs = trip?.legs || [];
  const coordinates = legs.flatMap((leg, index) => {
    const decoded = decodePolyline6(leg.shape);
    return index ? decoded.slice(1) : decoded;
  });
  if (coordinates.length < 2) return failure('NO_ROUTE_IN_COMPONENT', 'Valhalla returned no route geometry.');

  const instructions = legs.flatMap((leg) => leg.maneuvers || []).map((maneuver, index, all) => ({
    type: index === 0 ? 'depart' : index === all.length - 1 ? 'arrive' : 'maneuver',
    nativeType: maneuver.type,
    text: maneuver.instruction,
    distance_m: Number(maneuver.length || 0) * 1000,
    estimated_duration_s: Number(maneuver.time || 0)
  }));
  const warnings = avoidedEdgesRequested
    ? ['This Valhalla SDK does not expose per-edge avoidance; the standard local costing profile was used.']
    : [];

  return {
    ok: true,
    geometry: { type: 'LineString', coordinates },
    distance_m: Number(trip.summary?.length || 0) * 1000,
    estimated_duration_s: Number(trip.summary?.time || 0),
    edge_ids: [],
    source_provenance_ids: [],
    instructions,
    warnings,
    graph_version: result.dataset?.valhallaRevision || result.dataset?.release || 'valhalla-wasm',
    policy_version: `valhalla-${costing}`,
    cell_id: cell?.id || null,
    confidence: { minimum: 1, average: 1 },
    dataset_release: result.dataset?.release || null,
    diagnostics: result.diagnostics || null
  };
}

export function decodePolyline6(shape) {
  if (typeof shape !== 'string' || !shape) return [];
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < shape.length) {
    const latitude = decodeSignedValue(shape, index);
    index = latitude.index;
    const longitude = decodeSignedValue(shape, index);
    index = longitude.index;
    lat += latitude.value;
    lon += longitude.value;
    coordinates.push([lon / 1e6, lat / 1e6]);
  }
  return coordinates;
}

function decodeSignedValue(shape, start) {
  let result = 0;
  let shift = 0;
  let index = start;
  let byte;
  do {
    if (index >= shape.length) throw new Error('Valhalla returned an invalid polyline6 shape.');
    byte = shape.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return { index, value: result & 1 ? ~(result >> 1) : result >> 1 };
}

function mapRoutingError(code) {
  if (['NO_ROUTE', 'LOCATION_NOT_FOUND', 'OUTSIDE_COVERAGE'].includes(code)) return 'NO_ROUTE_IN_COMPONENT';
  if (['TIMEOUT', 'QUEUE_TIMEOUT'].includes(code)) return 'ROUTING_TIMEOUT';
  if (['RESOURCE_LIMIT', 'QUEUE_FULL'].includes(code)) return 'ROUTING_SEARCH_LIMIT';
  if (['INCOMPATIBLE_DATASET', 'INCOMPATIBLE_RUNTIME', 'DATASET_MISMATCH', 'INCOMPLETE_DATASET', 'CORRUPT_TILE', 'INVALID_RANGE'].includes(code)) return 'GRAPH_ARTIFACT_MISMATCH';
  if (['NETWORK', 'ACCESS_DENIED', 'RANGE_UNSUPPORTED', 'DATASET', 'NOT_INITIALIZED'].includes(code)) return 'GRAPH_VERSION_UNAVAILABLE';
  if (['INVALID_REQUEST', 'UNSUPPORTED_COSTING'].includes(code)) return 'INVALID_ROUTE_REQUEST';
  return 'ROUTING_WORKER_ERROR';
}

function failure(type, reason, code = null) {
  return {
    ok: false,
    status: type,
    failure: { type, message: 'Valhalla could not calculate a local route.', reason, code }
  };
}

