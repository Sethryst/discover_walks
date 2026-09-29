/** Local/static adapter catalogue for the reviewed-source backlog. */
export const SOURCE_ADAPTERS_URL = './data/learn/source-adapters.json';

let cached;

export async function loadSourceAdapters({ fetchImpl = globalThis.fetch } = {}) {
  if (cached) return cached;
  const response = await fetchImpl(SOURCE_ADAPTERS_URL);
  if (!response.ok) throw new Error(`Static source adapter catalogue unavailable (${response.status}).`);
  const payload = await response.json();
  if (payload?.kind !== 'walking-static-source-adapters' || !Array.isArray(payload.records)) {
    throw new Error('Static source adapter catalogue has an unsupported shape.');
  }
  cached = payload;
  return cached;
}

export function sourceAdaptersForRegion(catalogue, regionId) {
  return (catalogue?.records || []).filter((record) => record.regionId === regionId);
}
