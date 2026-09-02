export class RegionInstaller {
  constructor({ db, opfs }) {
    this.db = db;
    this.opfs = opfs || this._createDefaultOpfs();
    this.storeName = 'region_installations';
  }

  async install(regionPackage) {
    if (!regionPackage) throw new Error('Region package is required');

    const regionId = regionPackage.id;
    const installDir = `regions/${regionId}`;

    try {
      await validatePmtiles(regionPackage);
      await this.opfs.ensureDirectory(installDir.split("/"));
      await this.opfs.writeFile(`${installDir}/${regionId}.pmtiles`, regionPackage.pmtilesBlob);
      await this.db.put('regions', {
        id: regionId,
        name: regionPackage.name,
        installedAt: new Date().toISOString(),
        metadata: regionPackage.manifest,
        status: 'installed'
      });
      await this.db.put('region_pois', {
        id: regionId,
        regionId,
        pois: regionPackage.poiData?.pois || []
      });
      await this.db.put('region_buckets', {
        id: regionId,
        regionId,
        buckets: regionPackage.bucketsData || {}
      });
      if (regionPackage.fieldEditionData) {
        await this.db.put('field_editions', { id: regionId, regionId, ...regionPackage.fieldEditionData });
      }
      return {
        id: regionId,
        name: regionPackage.name,
        installedAt: new Date().toISOString(),
        metadata: regionPackage.manifest,
        status: 'installed'
      };
    } catch (error) {
      await this.opfs.remove(installDir);
      throw error;
    }
  }

  async discoverInstalled() {
    const entries = await this.db.all('regions');
    return entries
      .filter((entry) => entry && entry.id)
      .map((entry) => ({ id: entry.id, name: entry.name || entry.id, installed: true }));
  }

  async load(regionId) {
    const metadata = await this.db.get('regions', regionId);
    const poiEntry = await this.db.get('region_pois', regionId);
    const bucketEntry = await this.db.get('region_buckets', regionId);
    const fieldEditionEntry = await this.db.get('field_editions', regionId);
    if (!metadata) return null;

    return {
      id: regionId,
      name: metadata.name || regionId,
      metadata: metadata.metadata || {},
      mapSource: { type: 'opfs', path: `regions/${regionId}/${regionId}.pmtiles` },
      pois: poiEntry?.pois || [],
      buckets: bucketEntry?.buckets || {},
      fieldEdition: fieldEditionEntry ? {
        places: fieldEditionEntry.places || { places: poiEntry?.pois || [] },
        routes: fieldEditionEntry.routes || { routes: [] },
        stories: fieldEditionEntry.stories || { stories: [] },
        sources: fieldEditionEntry.sources || { sources: [] }
      } : null,
      ready: true
    };
  }

  _createDefaultOpfs() {
    if (globalThis.navigator?.storage?.getDirectory) {
      return new BrowserOpfsStorage();
    }
    return {
      async ensureDirectory() {},
      async writeFile() {},
      async readFile() { return null; },
      async remove() {}
    };
  }
}

async function validatePmtiles(regionPackage) {
  const blob = regionPackage.pmtilesBlob;
  if (!blob?.arrayBuffer) throw new Error('Region package PMTiles is missing.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const magic = new TextDecoder('ascii').decode(bytes.subarray(0, 7));
  if (bytes.length <= 127 || magic !== 'PMTiles') throw new Error('Region package PMTiles header is invalid.');
  const checksums = regionPackage.manifest?.checksums || {};
  const artifact = regionPackage.manifest?.artifacts?.pmtiles || `${regionPackage.id}.pmtiles`;
  const declared = checksums[artifact] || Object.entries(checksums).find(([name]) => name.endsWith('.pmtiles'))?.[1];
  if (!declared) return;
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot verify the PMTiles checksum.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const actual = `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (String(declared).toLocaleLowerCase() !== actual) throw new Error('Region package PMTiles checksum does not match.');
}

class BrowserOpfsStorage {
  async ensureDirectory(pathParts) {
    const root = await globalThis.navigator.storage.getDirectory();
    let handle = root;
    for (const part of pathParts.flat()) {
      if (!part) continue;
      handle = await handle.getDirectoryHandle(part, { create: true });
    }
    return handle;
  }

  async writeFile(path, blob) {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    const directory = await this.ensureDirectory(parts);
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return fileName;
  }

  async readFile(path) {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    const directory = await this.ensureDirectory(parts);
    const fileHandle = await directory.getFileHandle(fileName);
    return fileHandle.getFile();
  }

  async remove(path) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return;
    const fileName = parts.pop();
    const directory = await this.ensureDirectory(parts);
    try {
      await directory.removeEntry(fileName);
    } catch {
      // Ignore cleanup errors in the browser runtime.
    }
  }
}
