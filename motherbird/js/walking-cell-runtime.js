import { state } from './state.js';
import { WalkingCellRegistry } from './walking-cell-registry.js';
import { WalkingCellCache } from './walking-cell-cache.js';

let registryPromise = null;
let activation = null;

export function walkingCellManifestUrl() {
  return globalThis.MOTHER_BIRD_WALKING_CELLS?.manifestUrl
    || globalThis.document?.querySelector?.('meta[name="motherbird-walking-cell-registry"]')?.content
    || null;
}

export async function activateWalkingCellAt(point, { manifestUrl = walkingCellManifestUrl(), cache = new WalkingCellCache() } = {}) {
  if (!manifestUrl || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  registryPromise ||= WalkingCellRegistry.load(manifestUrl).catch((error) => { registryPromise = null; throw error; });
  const registry = await registryPromise;
  const cell = registry.find(point.lat, point.lng);
  if (!cell) return null;
  if (state.walkingCell?.id === cell.id && state.walkingCell?.release === registry.release) return state.walkingCell;
  if (activation?.key === `${registry.release}/${cell.id}`) return activation.promise;
  const promise = cache.ensureCell(registry.release, cell).then((files) => {
    const active = Object.freeze({ id: cell.id, release: registry.release, bounds: cell.bounds, files });
    state.walkingCell = active;
    window.dispatchEvent(new CustomEvent('walking-cell-ready', { detail: active }));
    return active;
  }).finally(() => { activation = null; });
  activation = { key: `${registry.release}/${cell.id}`, promise };
  return promise;
}

export function resetWalkingCellRegistryForTests() { registryPromise = null; activation = null; }
