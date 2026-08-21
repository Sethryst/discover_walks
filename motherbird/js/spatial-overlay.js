import RBush from '../vendor/rbush/rbush.js';

function recordBbox(record) {
  if (!record || record.id === undefined || record.id === null || record.id === '') throw new TypeError('A session spatial record needs a stable ID.');
  if (Array.isArray(record.bbox) && record.bbox.length === 4) {
    const [west, south, east, north] = record.bbox;
    if ([west, south, east, north].every(Number.isFinite) && west <= east && south <= north) return [west, south, east, north];
  }
  if (Number.isFinite(record.lng) && Number.isFinite(record.lat)) return [record.lng, record.lat, record.lng, record.lat];
  throw new TypeError(`Session spatial record ${record.id} needs finite lng and lat, or a valid bbox.`);
}

function entryFor(record) {
  const [minX, minY, maxX, maxY] = recordBbox(record);
  return { id: String(record.id), record, minX, minY, maxX, maxY };
}

/** Mutable, session-scoped deltas. It deliberately has no storage or network dependency. */
export class SessionSpatialOverlay {
  constructor() {
    this.kind = 'rbush-session-overlay';
    this.tree = new RBush();
    this.entries = new Map();
    this.tombstones = new Map();
  }

  upsert(record) {
    const entry = entryFor(record);
    const existing = this.entries.get(entry.id);
    if (existing) this.tree.remove(existing, (left, right) => left.id === right.id);
    this.entries.set(entry.id, entry);
    this.tree.insert(entry);
    // A new local observation is an explicit correction or reopening of an earlier session hide.
    this.tombstones.delete(entry.id);
    return entry.record;
  }

  remove(id, metadata = {}) {
    const key = String(id);
    const existing = this.entries.get(key);
    if (existing) this.tree.remove(existing, (left, right) => left.id === right.id);
    this.entries.delete(key);
    const tombstone = { id: key, kind: 'local-hide', reason: metadata.reason || 'session', createdAt: metadata.createdAt || new Date().toISOString() };
    this.tombstones.set(key, tombstone);
    return tombstone;
  }

  isTombstoned(id) { return this.tombstones.has(String(id)); }
  getById(id) { return this.entries.get(String(id))?.record || null; }
  searchBbox(west, south, east, north) { return this.tree.search({ minX: west, minY: south, maxX: east, maxY: north }).map((entry) => entry.record); }
  clear() { this.tree.clear(); this.entries.clear(); this.tombstones.clear(); }
  status() { return { provider: this.kind, sessionRecords: this.entries.size, tombstones: this.tombstones.size }; }
}

export const spatialOverlayTestHelpers = { recordBbox };
