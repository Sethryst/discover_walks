import { visitedPoiIds } from './poi-visit-tracking.js';

export class FederalRegionProgress {
  constructor(baseUrl = './federal-regions', { fetchImpl = globalThis.fetch } = {}) { this.url = `${String(baseUrl).replace(/\/$/, '')}/poi-progress.json`; this.fetchImpl = fetchImpl?.bind(globalThis); this.promise = null; }
  async forRegion(regionId, profile) {
    if (!regionId) return null;
    try {
      this.promise ||= this.load();
      const index = await this.promise; const region = index.regions?.[regionId];
      if (!region) return null;
      const visited = visitedPoiIds(profile); const count = region.poiIds.reduce((total, id) => total + (visited.has(id) ? 1 : 0), 0);
      return { visited: count, total: region.total };
    } catch { return null; }
  }
  async load() { const response = await this.fetchImpl(this.url); if (!response.ok) throw new Error(`Federal POI progress returned ${response.status}.`); const payload = await response.json(); if (payload?.schemaVersion !== 1 || payload.artifactType !== 'federal-region-poi-progress') throw new Error('Federal POI progress schema is incompatible.'); return payload; }
}
