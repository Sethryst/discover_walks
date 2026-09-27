import { state } from './state.js';
import { el } from './utils.js';
import db from './storage.js';
import { RegionInstaller } from './region-installer.js';
import { RegionAPI } from './region-api.js';
import { RegionPackage } from './region-package.js';
import { canUseOfflineRegion } from './entitlements.js';
import { FieldEditionLoader } from './field-edition-loader.js';
import { CITIES } from './constants.js';
import { downloadPublishedStateProduct, fetchOsmReleaseManifest } from './osm-release.js';
import { acquisitionPlacesForRegion, loadActiveAcquisitionPackage } from './acquisition-package-runtime.js';

export const regionInstaller = new RegionInstaller({ db });

export function createRegionRuntimeApi() {
  return new RegionAPI({
    installer: regionInstaller,
    packageResolver: async (regionId) => {
      const manifestUrl = `./regions/${regionId}/manifest.json`;
      const fallbackManifestUrl = `./regions/${regionId}/metadata.json`;

      try {
        const manifestResponse = await fetch(manifestUrl);
        if (manifestResponse.ok) {
          const manifest = await manifestResponse.json();
          const pmtilesResponse = await fetch(`./regions/${regionId}/${regionId}.pmtiles`);
          const poiResponse = await fetch(`./regions/${regionId}/${regionId}-poi.json`);
          const bucketsResponse = await fetch(`./regions/${regionId}/${regionId}-buckets.json`);

          if (!pmtilesResponse.ok || !poiResponse.ok || !bucketsResponse.ok) {
            return null;
          }

          return new RegionPackage({
            id: regionId,
            manifest,
            pmtilesBlob: await pmtilesResponse.blob(),
            poiData: await poiResponse.json(),
            bucketsData: await bucketsResponse.json()
          });
        }
      } catch {
        // fall through to metadata fallback
      }

      try {
        const manifestResponse = await fetch(fallbackManifestUrl);
        if (!manifestResponse.ok) return null;
        const manifest = await manifestResponse.json();
        const pmtilesResponse = await fetch(`./regions/${regionId}/${regionId}.pmtiles`);
        const poiResponse = await fetch(`./regions/${regionId}/${regionId}-poi.json`);
        const bucketsResponse = await fetch(`./regions/${regionId}/${regionId}-buckets.json`);

        if (!pmtilesResponse.ok || !poiResponse.ok || !bucketsResponse.ok) {
          return null;
        }

        return new RegionPackage({
          id: regionId,
          manifest,
          pmtilesBlob: await pmtilesResponse.blob(),
          poiData: await poiResponse.json(),
          bucketsData: await bucketsResponse.json()
        });
      } catch {
        return null;
      }
    }
  });
}

export const regionApi = createRegionRuntimeApi();
export const fieldEditionLoader = new FieldEditionLoader({ installer: regionInstaller });

export async function installPublishedOsmProduct(stateId, product) {
  const release = await fetchOsmReleaseManifest();
  const artifact = await downloadPublishedStateProduct(release, stateId, product);
  return regionInstaller.installOsmProduct({
    state: artifact.state,
    product,
    blob: artifact.blob,
    manifest: artifact.manifest
  });
}

export async function loadFieldEdition(id) {
  return fieldEditionLoader.loadEdition(id);
}

// Entitlement controls installation. Once installed, the region package is
// also the ordinary map's local POI and PMTiles source; the journal remains
// a separate private store.
export async function installFieldEditionRegion(regionId) {
  if (!canUseOfflineRegion(regionId)) {
    throw new Error('This offline region needs a Field Edition purchase or partner grant.');
  }
  return regionApi.installRegion(regionId);
}

export async function initRegionAutomation() {
  const chip = el('regionAutomationStatus');
  if (!chip) return;

  chip.textContent = 'Preparing region automation…';
  try {
    const installedRegions = await regionApi.discoverRegions();
    const activeRegionId = CITIES[state.activeCity]?.packId || state.activeCity;
    const region = installedRegions.some((entry) => entry.id === activeRegionId)
      ? await regionApi.loadRegion(activeRegionId)
      : null;
    const acquisitionPackage = await loadActiveAcquisitionPackage();
    const acquisitionPlaces = acquisitionPlacesForRegion(acquisitionPackage, [activeRegionId, CITIES[state.activeCity]?.id, CITIES[state.activeCity]?.packId]);
    if (acquisitionPlaces.length) {
      const base = state.cityPois[state.activeCity] || [];
      const merged = new Map(base.map((poi) => [String(poi.id), poi]));
      acquisitionPlaces.forEach((poi) => merged.set(String(poi.id), poi));
      state.cityPois[state.activeCity] = [...merged.values()];
    }

    state.regionAutomation = {
      ...region,
      installedRegions,
      acquisitionPackage,
      acquisitionPlaces,
      installer: regionInstaller
    };
    chip.textContent = region?.ready ? 'Region automation ready' : 'No installed offline region selected';
  } catch (error) {
    chip.textContent = 'Region automation unavailable';
    console.warn('Region automation init failed:', error);
  }
}
