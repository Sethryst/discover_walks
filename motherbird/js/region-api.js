export class RegionAPI {
  constructor({ installer, packageResolver }) {
    this.installer = installer;
    this.packageResolver = packageResolver;
  }

  async discoverRegions() {
    return this.installer.discoverInstalled();
  }

  async loadRegion(regionId) {
    const installed = await this.installer.load(regionId);
    if (installed) return installed;
    if (globalThis.navigator?.onLine === false) return null;

    const packageData = await this.packageResolver(regionId);
    if (!packageData) return null;
    return this.installRegion(regionId, packageData);
  }

  async installRegion(regionId, packageData = null) {
    if (!packageData && globalThis.navigator?.onLine === false) throw new Error('Install requires a connection. The current pack stays open.');
    const regionPackage = packageData || (await this.packageResolver(regionId));
    if (!regionPackage) return null;
    const installed = await this.installer.install(regionPackage);
    return {
      id: regionId,
      name: regionPackage.name,
      mapSource: { type: 'opfs', path: `regions/${regionId}/${regionId}.pmtiles` },
      pois: regionPackage.poiData?.pois || [],
      buckets: regionPackage.bucketsData || {},
      metadata: regionPackage.manifest,
      ready: true,
      installed
    };
  }
}
