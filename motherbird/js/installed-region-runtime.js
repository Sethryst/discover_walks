import { state } from './state.js';
import { CITIES } from './constants.js';
import { regionApi, regionInstaller } from './region-ui.js';
import { migratePoi } from './poi.js';

export function installedRegionIdForCity(cityId, installed = []) {
  const pack = CITIES[cityId] || {};
  const pathMatches = [...JSON.stringify(pack).matchAll(/\.\/regions\/([^/]+)\//g)].map((match) => match[1]);
  const candidates = [pack.runtimeRegionId, ...pathMatches, pack.packId, cityId].filter(Boolean).map(String);
  return candidates.find((id) => installed.some((entry) => String(entry.id) === id)) || null;
}

export async function activateInstalledRegionRuntime(cityId = state.activeCity) {
  const installedRegions = await regionApi.discoverRegions();
  const regionId = installedRegionIdForCity(cityId, installedRegions);
  const region = regionId ? await regionApi.loadRegion(regionId) : null;
  state.regionAutomation = { ...(region || {}), installedRegions, installer: regionInstaller, activeRegionId: regionId };
  if (region?.ready && Array.isArray(region.pois) && region.pois.length) {
    const base = state.cityPois[cityId] || [];
    const merged = new Map(base.map((poi) => [String(poi.id), poi]));
    region.pois.forEach((poi) => merged.set(String(poi.id), migratePoi(poi, cityId)));
    state.cityPois[cityId] = [...merged.values()];
  }
  window.dispatchEvent(new CustomEvent('installed-region-activated', { detail: region }));
  return region;
}
