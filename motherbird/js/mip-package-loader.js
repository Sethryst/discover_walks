import { getWalkingCellRegistry } from './walking-cell-runtime.js?v=20261104-local-mip-1';
import { validateEdgeFeatureSidecar } from './mip-features.js?v=20261104-local-mip-1';

const memory = new Map();

/**
 * Load graph-aligned MIP evidence from static regional artifacts. Artifact
 * URLs come only from the region registry; route coordinates never enter a
 * URL, header, request body, or referrer.
 */
export async function loadMIPPackageForRoute(route, {
  fetchImpl = globalThis.fetch,
  cacheStorage = globalThis.caches,
  registry: suppliedRegistry = null
} = {}) {
  if (!route?.cellId || typeof fetchImpl !== 'function') return empty('NO_ROUTE_CELL');
  let registry;
  try { registry = suppliedRegistry || await getWalkingCellRegistry(); }
  catch (error) { return empty('REGISTRY_UNAVAILABLE', error?.message); }
  const cell = registry.cells.find((candidate) => candidate.id === route.cellId);
  if (!cell) return empty('CELL_NOT_FOUND');
  const edgeArtifact = cell.artifacts?.edge_features;
  const corridorArtifact = cell.artifacts?.corridor_catalogue;
  if (!edgeArtifact || !corridorArtifact) return empty('MIP_PACKAGE_NOT_INSTALLED');
  const key = `${registry.release}/${cell.id}/${edgeArtifact.sha256 || edgeArtifact.url}/${corridorArtifact.sha256 || corridorArtifact.url}`;
  if (memory.has(key)) return memory.get(key);
  const promise = Promise.all([
    loadStaticJson(edgeArtifact, { fetchImpl, cacheStorage }),
    loadStaticJson(corridorArtifact, { fetchImpl, cacheStorage })
  ]).then(([sidecar, corridorCatalogue]) => {
    const validation = validateEdgeFeatureSidecar(sidecar, {
      graphVersion: route.graphVersion,
      cellId: route.cellId,
      routingRelease: route.cellRelease
    });
    if (!validation.valid) return empty(validation.reason);
    return Object.freeze({ available: true, sidecar, corridorCatalogue: Array.isArray(corridorCatalogue) ? corridorCatalogue : corridorCatalogue.corridors || [], source: 'installed-regional-package', cellId: cell.id });
  }).catch((error) => {
    memory.delete(key);
    return empty('MIP_PACKAGE_UNAVAILABLE', error?.message);
  });
  memory.set(key, promise);
  return promise;
}

async function loadStaticJson(artifact, { fetchImpl, cacheStorage }) {
  const url = new URL(artifact.url, globalThis.location?.href || 'http://localhost/').href;
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Static MIP artifact returned HTTP ${response.status}.`);
    const copy = response.clone();
    void cacheStorage?.open?.('motherbird-mip-packages-v1').then((cache) => cache.put(url, copy)).catch(() => {});
  } catch (networkError) {
    response = await cacheStorage?.match?.(url);
    if (!response) throw networkError;
  }
  const bytes = await response.arrayBuffer();
  if (artifact.bytes != null && bytes.byteLength !== Number(artifact.bytes)) throw new Error('Static MIP artifact size mismatch.');
  if (artifact.sha256) {
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
    if (actual !== String(artifact.sha256).replace(/^sha256:/, '')) throw new Error('Static MIP artifact checksum mismatch.');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function empty(reason, detail = null) {
  return Object.freeze({ available: false, sidecar: null, corridorCatalogue: [], source: null, reason, detail });
}

export function resetMIPPackageCacheForTests() { memory.clear(); }

