import { state } from './state.js';
import { WalkingCellRegistry } from './walking-cell-registry.js?v=20261006-routing-recovery-1';

let registryPromise = null;
let activation = null;

export async function getWalkingCellRegistry(manifestUrl = walkingCellManifestUrl()) {
  if (!manifestUrl) throw new Error('NO_WALKING_CELL_MANIFEST');
  registryPromise ||= WalkingCellRegistry.load(manifestUrl).catch((error) => { registryPromise = null; throw error; });
  return registryPromise;
}

export function walkingCellManifestUrl() {
  return globalThis.document?.querySelector?.('meta[name="motherbird-walking-cell-registry"]')?.content
    || globalThis.MOTHER_BIRD_WALKING_CELLS?.manifestUrl
    || null;
}

export async function activateWalkingCellAt(point, { manifestUrl = walkingCellManifestUrl(), allowNearestCellLock = false, maxLockMeters = 5000 } = {}) {
  if (!manifestUrl) return Object.freeze({ id: null, release: null, availability: 'unavailable', reason: 'NO_WALKING_CELL_MANIFEST' });
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return Object.freeze({ id: null, release: null, availability: 'unavailable', reason: 'INVALID_WALKING_CELL_COORDINATE' });
  const registry = await getWalkingCellRegistry(manifestUrl);
  // Prefer the most specific cell, but fall back to an overlapping routable
  // cell when an adaptive shard is map-only or its graph build is unavailable.
  const matches = registry.findAll(point.lat, point.lng);
  const cellMatch = matches.find((candidate) => candidate.availability !== 'routing_unavailable' && candidate.availability !== 'build_failed');
  const nearest = !cellMatch && allowNearestCellLock ? registry.findNearest(point.lat, point.lng) : null;
  const cell = cellMatch || (nearest?.distance_m <= maxLockMeters ? nearest.cell : null) || matches[0];
  if (!cell) {
    state.walkingCell = Object.freeze({ id: null, release: registry.release, availability: 'unavailable', reason: 'NO_CELL_FOR_COORDINATE', nearestCell: nearest?.cell?.id || null, nearestCellDistanceM: nearest?.distance_m ?? null, files: {} });
    return state.walkingCell;
  }
  if (cell.availability === 'routing_unavailable' || cell.availability === 'build_failed') {
    const unavailable = Object.freeze({ id: cell.id, release: registry.release, bounds: cell.bounds, availability: cell.availability, files: {} });
    state.walkingCell = unavailable;
    return unavailable;
  }
  if (state.walkingCell?.id === cell.id && state.walkingCell?.release === registry.release) return state.walkingCell;
  if (activation?.key === `${registry.release}/${cell.id}`) return activation.promise;
  const promise = Promise.resolve().then(() => {
    const active = Object.freeze({
      id: cell.id,
      release: registry.release,
      bounds: cell.bounds,
      availability: cell.availability || 'routing_available',
      routingNeighbors: Array.isArray(cell.routingNeighbors) ? [...cell.routingNeighbors] : [],
      artifacts: cell.artifacts,
      files: {}
      ,lockOn: Boolean(nearest && !cellMatch)
      ,lockOnDistanceM: nearest?.distance_m ?? 0
    });
    state.walkingCell = active;
    window.dispatchEvent(new CustomEvent('walking-cell-ready', { detail: active }));
    return active;
  }).finally(() => { activation = null; });
  activation = { key: `${registry.release}/${cell.id}`, promise };
  return promise;
}

export function resetWalkingCellRegistryForTests() { registryPromise = null; activation = null; }
