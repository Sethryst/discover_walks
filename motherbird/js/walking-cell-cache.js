const CACHE_ROOT = ['walking-cells'];

export class WalkingCellCache {
  constructor({ storage = globalThis.navigator?.storage, fetchImpl = globalThis.fetch } = {}) {
    this.storage = storage;
    this.fetchImpl = fetchImpl;
  }

  async get(release, cellId, kind) {
    const directory = await this.#directory(release, cellId, false);
    if (!directory) return null;
    try { return await (await directory.getFileHandle(fileName(kind))).getFile(); }
    catch (error) { if (error?.name === 'NotFoundError') return null; throw error; }
  }

  async ensure(release, cell, kind) {
    const cached = await this.get(release, cell.id, kind);
    if (cached) return cached;
    const artifact = cell.artifacts[kind];
    const response = await fetchArtifact(this.fetchImpl, artifact);
    const blob = await response.blob();
    if (artifact.bytes && blob.size !== artifact.bytes) throw new Error(`${cell.id} ${kind} artifact size does not match its manifest.`);
    if (artifact.byteRange && blob.size !== artifact.byteRange.length) throw new Error(`${cell.id} ${kind} range is incomplete.`);
    if (artifact.sha256) await verifySha256(blob, artifact.sha256);
    const directory = await this.#directory(release, cell.id, true);
    const handle = await directory.getFileHandle(fileName(kind), { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort?.(); throw error; }
    return handle.getFile();
  }

  async ensureCell(release, cell) {
    const [map, graph] = await Promise.all([this.ensure(release, cell, 'map'), this.ensure(release, cell, 'graph')]);
    return { map, graph, paths: { map: opfsPath(release, cell.id, 'map'), graph: opfsPath(release, cell.id, 'graph') } };
  }

  async #directory(release, cellId, create) {
    if (!this.storage?.getDirectory) throw new Error('Origin Private File System is unavailable.');
    let directory = await this.storage.getDirectory();
    try {
      for (const part of [...CACHE_ROOT, safePart(release), safePart(cellId)]) directory = await directory.getDirectoryHandle(part, { create });
      return directory;
    } catch (error) { if (!create && error?.name === 'NotFoundError') return null; throw error; }
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
  if (!globalThis.crypto?.subtle) throw new Error('Artifact checksum verification is unavailable.');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (actual !== String(declared).replace(/^sha256:/i, '').toLowerCase()) throw new Error('Cell artifact checksum does not match.');
}

function safePart(value) {
  const part = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  if (!part || part === '.' || part === '..') throw new Error('Invalid OPFS cell path.');
  return part;
}

function fileName(kind) { return kind === 'map' ? 'network.pmtiles' : kind === 'graph' ? 'routing-graph.json' : (() => { throw new Error('Unknown cell artifact kind.'); })(); }
