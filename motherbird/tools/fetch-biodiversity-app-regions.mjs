import fs from 'node:fs/promises';
import path from 'node:path';
import { CITIES } from '../js/constants.js';
import { normalizeOccurrences } from './normalize-biodiversity.mjs';

const regionPaths = { arlington: 'arlington-va', 'falls-church': 'falls-church-va', fairfax: 'fairfax-county-va', alexandria: 'alexandria-va', loudoun: 'loudoun-county-va', vienna: 'vienna', newyork: 'new-york-city', pgcounty: 'prince-georges-county-md', dc: 'washington-dc', sedona: 'sedona-arizona', boise: 'boise-meridian-idaho', keystone: 'keystone-colorado' };
const existing = new Set(['alexandria', 'arlington', 'fairfax', 'falls-church', 'loudoun', 'vienna']);
const sourceVintage = process.env.BIODIVERSITY_SOURCE_VINTAGE || new Date().toISOString().slice(0, 10);
const only = new Set(process.argv.slice(2));
const candidates = Object.entries(CITIES).filter(([cityId, city]) => city.dataFile && !city.isSource && city.zoom >= 11 && !existing.has(cityId) && (!only.size || only.has(cityId)));
const halfHeight = (zoom) => Math.max(0.05, 0.35 * 2 ** (11 - zoom));
const queryFor = ({ center, zoom }) => { const h = halfHeight(zoom); const w = h / Math.max(0.2, Math.cos(Number(center.lat) * Math.PI / 180)); return `POLYGON((${center.lng - w} ${center.lat - h},${center.lng + w} ${center.lat - h},${center.lng + w} ${center.lat + h},${center.lng - w} ${center.lat + h},${center.lng - w} ${center.lat - h}))`; };
async function fetchRegion([cityId, city]) {
  const regionId = regionPaths[cityId] || cityId;
  const destination = path.resolve('regions', regionId, 'biodiversity', 'records.json');
  const existingPayload = JSON.parse(await fs.readFile(destination, 'utf8').catch(() => '{"records":[]}'));
  if (existingPayload.records?.length) return `${cityId}: kept ${existingPayload.records.length} existing records`;
  const geometry = queryFor(city);
  const params = new URLSearchParams({ datasetKey: '50c9509d-22c7-4a22-a47d-8c48425ef4a7', basisOfRecord: 'HUMAN_OBSERVATION', occurrenceStatus: 'PRESENT', geometry, limit: '300', offset: '0' });
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
    if (response.ok) break;
    if (response.status !== 429 || attempt === 4) throw new Error(`${cityId}: GBIF ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
  }
  const page = await response.json();
  const rows = page.results || [];
  const normalized = normalizeOccurrences(rows, { regionId, sourceVintage, boundaryVersion: `${regionId}-center-envelope-v1` });
  normalized.metadata = { ...normalized.metadata, fixture: false, sourceAccess: 'GBIF occurrence search API', sourceQuery: geometry, inputRows: rows.length, matchingRecordCount: page.count, coverageNote: 'Candidate center-envelope extract; replace with exact reviewed boundary before promotion.' };
  await fs.writeFile(destination, `${JSON.stringify(normalized, null, 2)}\n`);
  return `${cityId}: ${normalized.records.length} records from ${rows.length} rows`;
}
const results = [];
for (const candidate of candidates) results.push(await fetchRegion(candidate));
console.log(results.join('\n'));
