import { Flatbush } from '../vendor/flatbush/flatbush.js';

export const SPATIAL_INDEX_SCHEMA_VERSION = 1;

function validateBbox(west, south, east, north) {
  if (![west, south, east, north].every(Number.isFinite) || west > east || south > north) {
    throw new TypeError('Spatial query requires a valid [west, south, east, north] bbox.');
  }
}

/** Dependency-free reference and fail-safe implementation. */
export class SpatialGridIndex {
  constructor(cellDegrees = 0.01) {
    this.kind = 'grid';
    this.cellDegrees = cellDegrees;
    this.cells = new Map();
    this.records = new Map();
    this.bounds = new Map();
  }

  insert(record, bbox = [record.lng, record.lat, record.lng, record.lat]) {
    const [west, south, east, north] = bbox;
    validateBbox(west, south, east, north);
    this.records.set(String(record.id), record);
    this.bounds.set(String(record.id), bbox);
    const minX = Math.floor(west / this.cellDegrees); const maxX = Math.floor(east / this.cellDegrees);
    const minY = Math.floor(south / this.cellDegrees); const maxY = Math.floor(north / this.cellDegrees);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}:${y}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(record);
    }
  }

  searchBbox(west, south, east, north) {
    validateBbox(west, south, east, north);
    const found = new Map();
    const minX = Math.floor(west / this.cellDegrees); const maxX = Math.floor(east / this.cellDegrees);
    const minY = Math.floor(south / this.cellDegrees); const maxY = Math.floor(north / this.cellDegrees);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      (this.cells.get(`${x}:${y}`) || []).forEach((record) => {
        const [recordWest, recordSouth, recordEast, recordNorth] = this.bounds.get(String(record.id));
        if (east >= recordWest && north >= recordSouth && west <= recordEast && south <= recordNorth) found.set(String(record.id), record);
      });
    }
    return [...found.values()];
  }

  getById(id) { return this.records.get(String(id)) || null; }
  status() { return { provider: this.kind, records: this.records.size, cells: this.cells.size }; }
}

/** Immutable Flatbush binary plus a stable-ID sidecar and runtime records. */
export class FlatbushPackageIndex {
  constructor({ data, ids, records, expectedCount }) {
    if (!(data instanceof ArrayBuffer)) throw new TypeError('Flatbush package data must be an ArrayBuffer.');
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) throw new TypeError('Flatbush ID sidecar is invalid.');
    if (new Set(ids).size !== ids.length) throw new Error('Flatbush ID sidecar contains duplicate stable IDs.');
    this.kind = 'flatbush-package';
    this.index = Flatbush.from(data);
    if (this.index.numItems !== ids.length || (expectedCount !== undefined && expectedCount !== ids.length)) {
      throw new Error(`Flatbush item count mismatch: binary=${this.index.numItems}, ids=${ids.length}, manifest=${expectedCount}.`);
    }
    this.ids = ids;
    this.records = records instanceof Map ? records : new Map((records || []).map((record) => [String(record.id), record]));
    const missing = ids.filter((id) => !this.records.has(id));
    if (missing.length) throw new Error(`Flatbush runtime records are missing stable IDs: ${missing.slice(0, 3).join(', ')}.`);
    if (this.records.size !== ids.length) throw new Error(`Flatbush runtime record count differs from the immutable package: records=${this.records.size}, indexed=${ids.length}.`);
  }

  searchBbox(west, south, east, north) {
    validateBbox(west, south, east, north);
    return this.index.search(west, south, east, north).map((ordinal) => this.records.get(this.ids[ordinal])).filter(Boolean);
  }

  nearest(lng, lat, limit = 1, maxDistanceDegrees = Infinity) {
    if (![lng, lat].every(Number.isFinite) || !Number.isInteger(limit) || limit < 1) throw new TypeError('Invalid nearest-candidate query.');
    return this.index.neighbors(lng, lat, limit, maxDistanceDegrees).map((ordinal) => this.records.get(this.ids[ordinal])).filter(Boolean);
  }

  getById(id) { return this.records.get(String(id)) || null; }
  status() { return { provider: this.kind, records: this.ids.length, nodeSize: this.index.nodeSize }; }
}

/** Presents an immutable base and a mutable session overlay as one candidate provider. */
export class CompositeSpatialIndex {
  constructor(baseIndex, overlay) {
    this.kind = 'composite';
    this.baseIndex = baseIndex;
    this.overlay = overlay;
  }

  searchBbox(west, south, east, north) {
    const merged = new Map();
    this.baseIndex.searchBbox(west, south, east, north).forEach((record) => {
      const id = String(record.id);
      if (!this.overlay.isTombstoned(id)) merged.set(id, this.overlay.getById(id) || record);
    });
    this.overlay.searchBbox(west, south, east, north).forEach((record) => {
      if (!this.overlay.isTombstoned(record.id)) merged.set(String(record.id), record);
    });
    return [...merged.values()];
  }

  getById(id) {
    if (this.overlay.isTombstoned(id)) return null;
    return this.overlay.getById(id) || this.baseIndex.getById(id);
  }

  status() {
    const base = this.baseIndex.status(); const overlay = this.overlay.status();
    return { ...overlay, provider: this.kind, baseProvider: base.provider, records: base.records };
  }
}

export function createGridIndex(records) {
  const index = new SpatialGridIndex();
  records.filter((record) => Number.isFinite(record.lat) && Number.isFinite(record.lng)).forEach((record) => index.insert(record));
  return index;
}

export const spatialProviderTestHelpers = { validateBbox };
