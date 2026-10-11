import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeOccurrences } from './normalize-biodiversity.mjs';

const region = process.argv[2];
const rowsWanted = Math.min(10000, Math.max(300, Number(process.argv[3] || 10000)));
const definitions = {
  vienna: { regionId: 'vienna', boundaryVersion: 'vienna-city-envelope-v1', geometry: 'POLYGON((-77.32 38.86,-77.20 38.86,-77.20 38.96,-77.32 38.96,-77.32 38.86))', boundary: (lat, lon) => lat >= 38.86 && lat <= 38.96 && lon >= -77.32 && lon <= -77.20 },
  'falls-church': { regionId: 'falls-church-va', boundaryVersion: 'falls-church-va-boundary-v1', geometry: 'POLYGON((-77.20 38.84,-77.14 38.84,-77.14 38.92,-77.20 38.92,-77.20 38.84))', boundary: (lat, lon) => lat >= 38.84 && lat <= 38.92 && lon >= -77.20 && lon <= -77.14 }
};
const definition = definitions[region];
if (!definition) throw new Error(`Usage: node tools/fetch-biodiversity-region.mjs ${Object.keys(definitions).join('|')} [rows]`);

const params = new URLSearchParams({ datasetKey: '50c9509d-22c7-4a22-a47d-8c48425ef4a7', basisOfRecord: 'HUMAN_OBSERVATION', occurrenceStatus: 'PRESENT', geometry: definition.geometry, limit: '300', offset: '0' });
const rows = [];
let matchingRecordCount = null;
while (rows.length < rowsWanted) {
  params.set('offset', String(rows.length));
  const response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
  if (!response.ok) throw new Error(`GBIF search failed at offset ${rows.length}: ${response.status}`);
  const page = await response.json();
  matchingRecordCount ??= page.count;
  rows.push(...(page.results || []));
  console.log(`${region}: fetched ${Math.min(rows.length, rowsWanted)} / ${rowsWanted} (matching ${matchingRecordCount})`);
  if (!page.results?.length || rows.length >= page.count) break;
}
const normalized = normalizeOccurrences(rows, { regionId: definition.regionId, boundary: definition.boundary, sourceVintage: new Date().toISOString().slice(0, 10), boundaryVersion: definition.boundaryVersion });
normalized.metadata = { ...normalized.metadata, fixture: false, sourceAccess: 'GBIF occurrence search API', sourceQuery: definition.geometry, inputRows: rows.length, matchingRecordCount, acquisitionWorkflow: { mode: 'occurrence-search', endpoint: 'https://api.gbif.org/v1/occurrence/search', pageSize: 300, maxOffset: 100000 } };
const destination = path.resolve('regions', definition.regionId, 'biodiversity', 'records.json');
await fs.writeFile(destination, `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`Wrote ${normalized.records.length} normalized records to ${destination}`);
