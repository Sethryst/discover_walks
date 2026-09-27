/** Read-only access to the latest audited acquisition package publication. */

export async function loadActiveAcquisitionPackage({ fetchImpl = globalThis.fetch, base = './data/acquisition-packages' } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  try {
    const activeResponse = await fetchImpl(`${base}/active.json`, { cache: 'no-store' });
    if (!activeResponse.ok) return null;
    const active = await activeResponse.json();
    const packageId = active?.activePackageId;
    if (!packageId || !/^[A-Za-z0-9._-]+$/.test(packageId)) return null;
    const packageResponse = await fetchImpl(`${base}/${encodeURIComponent(packageId)}.json`, { cache: 'no-store' });
    if (!packageResponse.ok) return null;
    const payload = await packageResponse.json();
    if (payload?.schema !== 'motherbird-regional-package.v1' || payload.packageId !== packageId || !Array.isArray(payload.places)) return null;
    return { ...payload, activePackageId: packageId };
  } catch {
    return null;
  }
}

export function acquisitionPlacesForRegion(payload, regionIds = []) {
  if (!payload) return [];
  const ids = new Set(regionIds.filter(Boolean).map(String));
  if (payload.geography && ids.size && !ids.has(String(payload.geography))) return [];
  return payload.places.map((place) => ({ ...place, acquisitionPackageId: payload.packageId }));
}
