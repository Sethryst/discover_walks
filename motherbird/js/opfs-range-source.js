const ROOT = 'pmtiles-range-cache';

// PMTiles asks its Source for small immutable byte ranges. Persisting those
// ranges (rather than a multi-gigabyte Blob) makes every viewed tile reusable
// offline and keeps the archive suitable for ordinary HTTP Range hosting.
export class OpfsRangeSource {
  constructor(url, { key = url, storage = globalThis.navigator?.storage, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.url = new URL(url, globalThis.location?.href || 'http://localhost/').href;
    this.key = String(key);
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.inflight = new Map();
  }

  getKey() { return this.key; }

  async getBytes(offset, length, signal) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) throw new Error('Invalid PMTiles byte range.');
    const name = `${offset}-${length}.bin`;
    const cached = await this.#read(name);
    if (cached) return { data: await cached.arrayBuffer() };
    if (globalThis.navigator?.onLine === false) throw new Error('This PMTiles range has not been viewed on this device yet.');
    if (this.inflight.has(name)) return this.inflight.get(name);
    const request = this.#fetchAndStore(name, offset, length, signal).finally(() => this.inflight.delete(name));
    this.inflight.set(name, request);
    return request;
  }

  async #fetchAndStore(name, offset, length, signal) {
    if (typeof this.fetchImpl !== 'function') throw new Error('PMTiles range fetching is unavailable.');
    const response = await this.fetchImpl(this.url, {
      method: 'GET', headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      credentials: 'omit', referrerPolicy: 'no-referrer', signal
    });
    if (response.status !== 206) throw new Error(`PMTiles host did not honor Range (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (blob.size !== length) throw new Error('PMTiles byte range is incomplete.');
    const directory = await this.#directory(true);
    if (directory) {
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try { await writable.write(blob); await writable.close(); }
      catch (error) { await writable.abort?.(); throw error; }
    }
    return { data: await blob.arrayBuffer(), etag: response.headers.get('etag') || undefined };
  }

  async #read(name) {
    const directory = await this.#directory(false);
    if (!directory) return null;
    try { return await (await directory.getFileHandle(name)).getFile(); }
    catch (error) { if (error?.name === 'NotFoundError') return null; throw error; }
  }

  async #directory(create) {
    if (!this.storage?.getDirectory) return null;
    let directory = await this.storage.getDirectory();
    try {
      for (const part of [ROOT, await cacheId(this.url)]) directory = await directory.getDirectoryHandle(part, { create });
      return directory;
    } catch (error) { if (!create && error?.name === 'NotFoundError') return null; throw error; }
  }
}

async function cacheId(value) {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    return [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `url-${(hash >>> 0).toString(16)}`;
}
