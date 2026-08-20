import { canUseOfflineRegion } from './entitlements.js';

const DEVELOPMENT = new URLSearchParams(globalThis.location?.search || '').has('fieldEditionDev') || ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
// A packaged app needs a discoverable local entry before any network request.
// Deployment catalogues can extend/replace this list as editions are added.
const BUNDLED_EDITIONS = [{
  id: 'meadowlark-gardens',
  title: 'Meadowlark Botanical Gardens Field Edition',
  bounds: { west: -77.2872806, south: 38.9340117, east: -77.2777596, north: 38.9411997 }
}];

export class FieldEditionLoader {
  constructor({ installer, fetchImpl = globalThis.fetch.bind(globalThis), baseUrl = new URL('../field-editions/', import.meta.url).href } = {}) {
    if (!installer) throw new Error('FieldEditionLoader requires an installer.');
    this.installer = installer;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async discoverAvailable() {
    try {
      const response = await this.fetch(`${this.baseUrl}index.json`);
      if (response.ok) return (await response.json()).editions || BUNDLED_EDITIONS;
    } catch { /* The bundled catalogue supports offline/local discovery. */ }
    return BUNDLED_EDITIONS;
  }

  async loadEdition(id) {
    const installed = await this.installer.load(id);
    if (installed) return this._activate(installed);
    if (!DEVELOPMENT && !canUseOfflineRegion(id)) throw new Error('This Field Edition requires access.');
    const edition = await this._fetchPackage(id);
    await this.installer.install(edition);
    return this._activate(await this.installer.load(id));
  }

  _activate(edition) {
    // The map adapter can subscribe and switch to the installed PMTiles source.
    // Keeping this event separate preserves the ordinary online map behavior.
    globalThis.dispatchEvent?.(new CustomEvent('field-edition-activated', { detail: edition }));
    return edition;
  }

  async _fetchPackage(id) {
    const root = `${this.baseUrl}${id}/generated/`;
    const manifestResponse = await this.fetch(`${root}manifest.json`);
    if (!manifestResponse.ok) throw new Error(`Field Edition '${id}' is not available locally.`);
    const manifest = await manifestResponse.json();
    if (manifest.id !== id || !manifest.artifacts?.map || !manifest.artifacts?.places) throw new Error('Invalid Field Edition manifest.');
    const read = async (artifact, type = 'json') => {
      const response = await this.fetch(`${root}${artifact}`);
      if (!response.ok) throw new Error(`Missing Field Edition artifact: ${artifact}`);
      const body = type === 'blob' ? await response.blob() : await response.text();
      const expected = manifest.checksums?.[artifact];
      if (expected && globalThis.crypto?.subtle) {
        const bytes = await body.arrayBuffer?.() || new TextEncoder().encode(body);
        const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        if (expected !== `sha256:${hash}`) throw new Error(`Field Edition artifact failed verification: ${artifact}`);
      }
      return type === 'blob' ? body : JSON.parse(body);
    };
    const [pmtilesBlob, places, routes, stories, sources] = await Promise.all([read(manifest.artifacts.map, 'blob'), read(manifest.artifacts.places), read(manifest.artifacts.routes), read(manifest.artifacts.stories), read(manifest.artifacts.sources)]);
    return { id, name: manifest.title, manifest, pmtilesBlob, poiData: { pois: places.places || [] }, bucketsData: {}, fieldEditionData: { places, routes, stories, sources } };
  }
}
