const CACHE_ROOT = ['walking-cells'];
const DEFAULT_SAFETY_RATIO = 0.85;
import db from './storage.js';

export class WalkingCellCache {
  constructor({ storage = globalThis.navigator?.storage, fetchImpl = globalThis.fetch } = {}) {
    this.storage = storage;
    this.fetchImpl = fetchImpl;
  }

  async get(release, cellId, kind) {
    const directory = await this.#directory(release, cellId, false);
    if (!directory) return null;
    try {
      const file = await (await directory.getFileHandle(fileName(kind))).getFile();
      await this.#touch(release, cellId, kind, file.size);
      return file;
    }
    catch (error) { if (error?.name === 'NotFoundError') { await this.#forget(release, cellId, kind).catch(() => {}); return null; } throw storageError('MISSING_ARTIFACT', `Walking-cell artifact is missing: ${release}/${cellId}/${kind}.`, error); }
  }

  async ensure(release, cell, kind) {
    const cached = await this.get(release, cell.id, kind);
    if (cached) {
      try {
        await verifyArtifact(cached, cell.artifacts[kind], kind, release, cell);
        return cached;
      } catch (_) {
        await this.remove(release, cell.id, kind).catch(() => {});
      }
    }
    const artifact = cell.artifacts[kind];
    let blob;
    try {
      const response = await fetchArtifact(this.fetchImpl, artifact);
      blob = await response.blob();
      await verifyArtifact(blob, artifact, kind, release, cell);
      const directory = await this.#directory(release, cell.id, true);
      const finalName = fileName(kind);
      const temporaryName = `.${finalName}.${globalThis.crypto?.randomUUID?.() || Date.now()}.part`;
      const temporaryHandle = await directory.getFileHandle(temporaryName, { create: true });
      const writable = await temporaryHandle.createWritable();
      try { await writable.write(blob); await writable.close(); } catch (error) { await writable.abort?.(); await directory.removeEntry(temporaryName).catch(() => {}); throw error; }
      const written = await temporaryHandle.getFile();
      await verifyArtifact(written, artifact, kind, release, cell);
      try {
        if (typeof temporaryHandle.move === 'function') await temporaryHandle.move(directory, finalName);
        else { const finalHandle = await directory.getFileHandle(finalName, { create: true }); const finalWritable = await finalHandle.createWritable(); await finalWritable.write(written); await finalWritable.close(); await directory.removeEntry(temporaryName); }
      } catch (error) { await directory.removeEntry(temporaryName).catch(() => {}); throw error; }
      const handle = await directory.getFileHandle(finalName);
      await this.#touch(release, cell.id, kind, blob.size);
      await this.#evictIfNeeded(`${release}/${cell.id}/${kind}`);
      return handle.getFile();
    } catch (error) {
      await this.remove(release, cell.id, kind).catch(() => {});
      throw error;
    }
  }

  async remove(release, cellId, kind) {
    const directory = await this.#directory(release, cellId, false);
    if (!directory) return;
    try { await directory.removeEntry(fileName(kind)); } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
    await this.#forget(release, cellId, kind);
  }

  async ensureCell(release, cell) {
    const kinds = Object.keys(cell.artifacts);
    const entries = await Promise.all(kinds.map(async (kind) => {
      const artifact = cell.artifacts[kind];
      if (kind !== 'graph' && isRangeBackedArchive(artifact)) return [kind, { type: 'range', url: artifact.url, key: `${release}/${cell.id}/${kind}` }];
      const file = await this.ensure(release, cell, kind);
      return [kind, { type: 'file', file, path: opfsPath(release, cell.id, kind) }];
    }));
    return Object.fromEntries(entries);
  }

  async #directory(release, cellId, create) {
    if (!this.storage?.getDirectory) throw new Error('Origin Private File System is unavailable.');
    let directory = await this.storage.getDirectory();
    try {
      for (const part of [...CACHE_ROOT, safePart(release), safePart(cellId)]) directory = await directory.getDirectoryHandle(part, { create });
      return directory;
    } catch (error) { if (!create && error?.name === 'NotFoundError') return null; throw error; }
  }

  async #touch(release, cellId, kind, bytes) {
    await db.put('walking_cell_metadata', { id: `${release}/${cellId}/${kind}`, release, cellId, kind, bytes, lastUsedAt: Date.now() });
  }

  async #forget(release, cellId, kind) {
    await db.remove('walking_cell_metadata', `${release}/${cellId}/${kind}`);
  }

  async #evictIfNeeded(protectedId) {
    const estimate = await this.storage?.estimate?.();
    if (!estimate?.quota || !estimate.usage || estimate.usage / estimate.quota < DEFAULT_SAFETY_RATIO) return;
    const records = (await db.all('walking_cell_metadata')).filter((record) => record.id !== protectedId).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const record of records) {
      const latest = await this.storage?.estimate?.();
      if (!latest?.quota || !latest.usage || latest.usage / latest.quota < 0.75) break;
      await this.remove(record.release, record.cellId, record.kind).catch(() => {});
    }
  }
}

export async function fetchArtifact(fetchImpl, artifact) {
  if (typeof fetchImpl !== 'function') throw new Error('Cell artifact fetch is unavailable.');
  const headers = new Headers();
  if (artifact.byteRange) headers.set('Range', `bytes=${artifact.byteRange.offset}-${artifact.byteRange.offset + artifact.byteRange.length - 1}`);
  const response = await fetchImpl(artifact.url, { method: 'GET', headers, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Cell artifact returned HTTP ${response.status}.`);
  // A range silently answered with 200 can be a multi-gigabyte national file.
  // Abort instead of accidentally accepting a full-state/national download.
  if (artifact.byteRange && response.status !== 206) throw new Error('Static storage did not honor the cell byte-range request.');
  return response;
}

export function opfsPath(release, cellId, kind) {
  return [...CACHE_ROOT, safePart(release), safePart(cellId), fileName(kind)].join('/');
}

async function verifySha256(blob, declared) {
  if (!globalThis.crypto?.subtle) throw storageError('DATABASE_UNAVAILABLE', 'Artifact checksum verification is unavailable.');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (actual !== String(declared).replace(/^sha256:/i, '').toLowerCase()) throw storageError('CHECKSUM_MISMATCH', 'Cell artifact checksum does not match.');
}

async function verifyArtifact(blob, artifact, kind, release, cell) {
  if (artifact.bytes != null && blob.size !== Number(artifact.bytes)) throw storageError('CHECKSUM_MISMATCH', `${cell.id} ${kind} artifact size does not match its manifest.`);
  if (artifact.byteRange && blob.size !== artifact.byteRange.length) throw storageError('CHECKSUM_MISMATCH', `${cell.id} ${kind} range is incomplete.`);
  if (artifact.sha256) await verifySha256(blob, artifact.sha256);
  if (kind === 'graph') await verifyGraph(blob, release, cell);
}

async function verifyGraph(blob, release, cell) {
  let graph;
  try { graph = JSON.parse(await blob.text()); } catch (_) { throw storageError('MALFORMED_ARTIFACT', 'Cell routing graph JSON is malformed.'); }
  if (graph?.schema_version !== 1 || graph?.format !== 'motherbird-runtime-graph-v1') throw storageError('MALFORMED_ARTIFACT', 'Cell routing graph version is unsupported.');
  const expectedDataset = `${release}:${cell.id}`;
  if (graph.source_version !== release || graph.dataset_id !== expectedDataset) throw storageError('CHECKSUM_MISMATCH', 'Cell routing graph metadata does not match its registry entry.');
}

function storageError(code, message, cause) { const error = new Error(message, cause ? { cause } : undefined); error.code = code; return error; }

function safePart(value) {
  const part = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  if (!part || part === '.' || part === '..') throw new Error('Invalid OPFS cell path.');
  return part;
}

function isRangeBackedArchive(artifact) { return ['http_range', 'pmtiles_range'].includes(artifact?.delivery?.mode || artifact?.mode); }
function fileName(kind) {
  return kind === 'map' ? 'network.pmtiles'
    : kind === 'poi' ? 'poi.pmtiles'
      : kind === 'graph' ? 'routing-graph.json'
        : ['nodes', 'edges', 'adjacency', 'edge_geometry', 'edge_spatial_index'].includes(kind) ? `${kind}.bin`
          : kind === 'edge_metadata' ? 'edge-metadata.json.gz'
          : (() => { throw new Error('Unknown cell artifact kind.'); })();
}
