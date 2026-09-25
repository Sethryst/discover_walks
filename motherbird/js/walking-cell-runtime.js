import { state } from './state.js';
import { WalkingCellRegistry } from './walking-cell-registry.js';

let registryPromise = null;
let activation = null;

export function walkingCellManifestUrl() {
  return globalThis.MOTHER_BIRD_WALKING_CELLS?.manifestUrl
    || globalThis.document?.querySelector?.('meta[name="motherbird-walking-cell-registry"]')?.content
    || null;
}

export async function activateWalkingCellAt(point, { manifestUrl = walkingCellManifestUrl() } = {}) {
  if (!manifestUrl || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  registryPromise ||= WalkingCellRegistry.load(manifestUrl).catch((error) => { registryPromise = null; throw error; });
  const registry = await registryPromise;
  const cell = registry.find(point.lat, point.lng);
  if (!cell) {
    state.walkingCell = Object.freeze({ id: null, release: registry.release, availability: 'unavailable', reason: 'NO_CELL_FOR_COORDINATE', files: {} });
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
    const active = Object.freeze({ id: cell.id, release: registry.release, bounds: cell.bounds, availability: cell.availability || 'routing_available', artifacts: cell.artifacts, files: {} });
    state.walkingCell = active;
    window.dispatchEvent(new CustomEvent('walking-cell-ready', { detail: active }));
    return active;
  }).finally(() => { activation = null; });
  activation = { key: `${registry.release}/${cell.id}`, promise };
  return promise;
}

export function resetWalkingCellRegistryForTests() { registryPromise = null; activation = null; }
