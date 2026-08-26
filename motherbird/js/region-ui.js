import { state } from './state.js';
import { el } from './utils.js';
import db from './storage.js';
import { RegionInstaller } from './region-installer.js';
import { RegionAPI } from './region-api.js';
import { RegionPackage } from './region-package.js';
import { canUseOfflineRegion } from './entitlements.js';
import { FieldEditionLoader } from './field-edition-loader.js';

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

export async function loadFieldEdition(id) {
  return fieldEditionLoader.loadEdition(id);
}

// PMTiles packages are a Field Edition delivery concern. The ordinary map,
// personal journal, and curated online experience remain outside this gate.
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
    const region = installedRegions.some((entry) => entry.id === 'fairfax')
      ? await regionApi.loadRegion('fairfax')
      : await regionApi.installRegion('fairfax');

    state.regionAutomation = {
      ...region,
      installedRegions,
      installer: regionInstaller
    };
    chip.textContent = region?.ready ? 'Region automation ready' : 'Region automation pending';
  } catch (error) {
    chip.textContent = 'Region automation unavailable';
    console.warn('Region automation init failed:', error);
  }
}
