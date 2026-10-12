const MANIFEST_URL = './data/regional-capabilities.json';
let manifestPromise;

export function regionIdForCity(cityId, city = {}) {
  return city.dataFile?.match(/regions\/([^/]+)\//)?.[1] || ({
    arlington: 'arlington-va', 'falls-church': 'falls-church-va', newyork: 'nyc', philadelphia: 'philadelphia',
    keystone: 'keystone-colorado', pgcounty: 'prince-georges-county-md', fairfax: 'fairfax-county-va',
    alexandria: 'alexandria-va', loudoun: 'loudoun-county-va', dc: 'washington-dc', sedona: 'sedona-arizona', boise: 'boise-meridian-idaho'
  }[cityId] || cityId);
}

export async function loadRegionalCapabilities() {
  manifestPromise ||= fetch(MANIFEST_URL).then((response) => {
    if (!response.ok) throw new Error(`Regional capabilities returned ${response.status}`);
    return response.json();
  });
  return manifestPromise;
}

export async function capabilitiesForRegion(regionId) {
  const manifest = await loadRegionalCapabilities();
  return manifest?.regions?.[regionId] || null;
}

export function capabilityIsAvailable(capability, { allowDeclaredEmpty = false } = {}) {
  return Boolean(capability && (capability.status === 'furnished' || capability.status === 'available' || (allowDeclaredEmpty && capability.status === 'declared-empty')));
}
