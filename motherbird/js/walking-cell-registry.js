export const WALKING_CELL_REGISTRY_FORMAT = 'motherbird-walking-cell-registry-v1';

export class WalkingCellRegistry {
  constructor(manifest, manifestUrl = globalThis.location?.href || 'http://localhost/') {
    if (manifest?.format !== WALKING_CELL_REGISTRY_FORMAT || !Array.isArray(manifest.cells)) {
      throw new Error('Unsupported walking-cell registry.');
    }
    this.release = String(manifest.release || manifest.version || 'unversioned');
    this.manifestUrl = new URL(manifestUrl, globalThis.location?.href || 'http://localhost/');
    this.cells = manifest.cells.map((cell) => normalizeCell(cell, this.manifestUrl));
  }

  static async load(url, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Walking-cell registry fetch is unavailable.');
    const manifestUrl = new URL(url, globalThis.location?.href || 'http://localhost/');
    // This request is deliberately invariant: coordinates never appear in the URL,
    // headers, body, or referrer. Matching happens only after the static index arrives.
    const response = await fetchImpl(manifestUrl, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Walking-cell registry returned HTTP ${response.status}.`);
    return new WalkingCellRegistry(await response.json(), manifestUrl);
  }

  find(lat, lng) {
    validateCoordinate(lat, lng);
    const matches = this.cells.filter((cell) => contains(cell.bounds, lat, lng));
    // Adaptive shards may overlap. Prefer the most specific cell, then stable ID.
    return matches.sort((a, b) => area(a.bounds) - area(b.bounds) || a.id.localeCompare(b.id))[0] || null;
  }
}

function normalizeCell(cell, baseUrl) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(cell?.id || '')) throw new Error('Walking-cell ID is invalid.');
  const bounds = Array.isArray(cell.bounds)
    ? { west: cell.bounds[0], south: cell.bounds[1], east: cell.bounds[2], north: cell.bounds[3] }
    : cell.bounds;
  if (![bounds?.west, bounds?.south, bounds?.east, bounds?.north].every(Number.isFinite)
      || bounds.south < -90 || bounds.north > 90 || bounds.south > bounds.north
      || bounds.west < -180 || bounds.west > 180 || bounds.east < -180 || bounds.east > 180) {
    throw new Error(`Walking-cell ${cell.id} has invalid bounds.`);
  }
  const artifacts = Object.fromEntries(Object.entries(cell.artifacts || {}).map(([kind, artifact]) => {
    if (!['map', 'graph'].includes(kind)) throw new Error(`Walking-cell ${cell.id} has an unsupported artifact kind.`);
    const path = artifact?.url || artifact?.path;
    if (!path) throw new Error(`Walking-cell ${cell.id} ${kind} artifact has no URL.`);
    const byteRange = normalizeRange(artifact.range || artifact.byteRange);
    return [kind, { ...artifact, url: new URL(path, baseUrl).href, byteRange }];
  }));
  if (!artifacts.map || !artifacts.graph) throw new Error(`Walking-cell ${cell.id} requires map and graph artifacts.`);
  return Object.freeze({ ...cell, id: cell.id, bounds: Object.freeze(bounds), artifacts: Object.freeze(artifacts) });
}

function normalizeRange(range) {
  if (!range) return null;
  const offset = Number(range.offset ?? range.start);
  const length = Number(range.length ?? (Number(range.end) - offset + 1));
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) throw new Error('Artifact byte range is invalid.');
  return Object.freeze({ offset, length });
}

function contains(bounds, lat, lng) {
  const longitudeMatch = bounds.west <= bounds.east
    ? lng >= bounds.west && lng <= bounds.east
    : lng >= bounds.west || lng <= bounds.east;
  return longitudeMatch && lat >= bounds.south && lat <= bounds.north;
}

function area(bounds) {
  const width = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  return width * (bounds.north - bounds.south);
}

function validateCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid walking-cell coordinate.');
}
