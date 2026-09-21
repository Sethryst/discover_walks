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
      const handle = await directory.getFileHandle(fileName(kind), { create: true });
      const writable = await handle.createWritable();
      try { await writable.write(blob); await writable.close(); }
      catch (error) { await writable.abort?.(); throw error; }
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

async function verifyArtifact(blob, artifact, kind, release, cell) {
  if (artifact.bytes != null && blob.size !== Number(artifact.bytes)) throw new Error(`${cell.id} ${kind} artifact size does not match its manifest.`);
  if (artifact.byteRange && blob.size !== artifact.byteRange.length) throw new Error(`${cell.id} ${kind} range is incomplete.`);
  if (artifact.sha256) await verifySha256(blob, artifact.sha256);
  if (kind === 'graph') await verifyGraph(blob, release, cell);
}

async function verifyGraph(blob, release, cell) {
  let graph;
  try { graph = JSON.parse(await blob.text()); } catch (_) { throw new Error('Cell routing graph JSON is malformed.'); }
  if (graph?.schema_version !== 1 || graph?.format !== 'motherbird-runtime-graph-v1') throw new Error('Cell routing graph version is unsupported.');
  const expectedDataset = `${release}:${cell.id}`;
  if (graph.source_version !== release || graph.dataset_id !== expectedDataset) throw new Error('Cell routing graph metadata does not match its registry entry.');
}

function safePart(value) {
  const part = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  if (!part || part === '.' || part === '..') throw new Error('Invalid OPFS cell path.');
  return part;
}

function isRangeBackedArchive(artifact) { return ['http_range', 'pmtiles_range'].includes(artifact?.delivery?.mode || artifact?.mode); }
function fileName(kind) { return kind === 'map' ? 'network.pmtiles' : kind === 'poi' ? 'poi.pmtiles' : kind === 'graph' ? 'routing-graph.json' : (() => { throw new Error('Unknown cell artifact kind.'); })(); }
