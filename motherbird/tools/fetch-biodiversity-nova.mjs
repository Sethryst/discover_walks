import fs from 'node:fs/promises';
import path from 'node:path';

const output = process.argv[2] || 'data/biodiversity-nova-source.json';
const rowsWanted = Math.max(300, Number(process.argv[3] || 10000));
const endpoint = 'https://api.gbif.org/v1/occurrence/search';
const params = new URLSearchParams({
  datasetKey: '50c9509d-22c7-4a22-a47d-8c48425ef4a7',
  basisOfRecord: 'HUMAN_OBSERVATION', occurrenceStatus: 'PRESENT',
  geometry: 'POLYGON((-77.6 38.65,-76.9 38.65,-76.9 39.25,-77.6 39.25,-77.6 38.65))',
  limit: '300', offset: '0'
});
const results = [];
let total = null;
while (results.length < rowsWanted) {
  params.set('offset', String(results.length));
  const response = await fetch(`${endpoint}?${params}`);
  if (!response.ok) throw new Error(`GBIF search failed at offset ${results.length}: ${response.status}`);
  const page = await response.json();
  total ??= page.count;
  results.push(...(page.results || []));
  console.log(`Fetched ${Math.min(results.length, rowsWanted)} / ${rowsWanted} candidate rows (source count ${total}).`);
  if (!page.results?.length || results.length >= page.count) break;
}
const payload = {
  schemaVersion: 'biodiversity-source-snapshot-v1', sourceAccess: 'GBIF public occurrence search API',
  datasetKey: params.get('datasetKey'), datasetName: 'iNaturalist Research-grade Observations',
  query: { basisOfRecord: params.get('basisOfRecord'), occurrenceStatus: params.get('occurrenceStatus'), geometry: params.get('geometry'), pageSize: 300, pageOffset: 0, rowsFetched: results.length, matchingRecordCount: total },
  retrievedAt: new Date().toISOString(), coverage: `First ${results.length} rows from the NOVA polygon query; candidate snapshot, not a complete authenticated GBIF download.`,
  downloadDoi: null, rawArchive: 'Held outside the repository; public source pages were normalized and split into regional candidates.',
  splitRegions: ['alexandria-va', 'arlington-va', 'fairfax-county-va', 'falls-church-va', 'loudoun-county-va', 'vienna'], surface: 'Nature first click; Learn remains the seasonal interpretation layer.', results
};
const destination = path.resolve(output);
await fs.writeFile(destination, JSON.stringify(payload) + '\n');
console.log(`Wrote ${results.length} rows to ${destination}`);
