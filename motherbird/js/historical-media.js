/** Load the compact approved archive index; media remains on-demand. */
export async function loadHistoricalMediaIndex(url = '/historical-media/releases/latest/app-index.json', fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Historical media index unavailable (${response.status})`);
  const payload = await response.json();
  if (payload.schema_version !== 1 || !Array.isArray(payload.records)) throw new Error('Invalid historical media index');
  return payload;
}

export function historicalMediaPresentation(record) {
  const precision = record.location?.precision || 'unknown';
  return { ...record, isApproximate: !['exact', 'address', 'venue'].includes(precision), locationLabel: `${precision} historical area` };
}
