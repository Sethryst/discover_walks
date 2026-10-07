import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { booleanPointInPolygon, point } from '@turf/turf';
import { normalizeOccurrences } from './normalize-biodiversity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [inputPath, outputRoot = 'regions', sourceVintage = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!inputPath) throw new Error('Usage: node tools/import-biodiversity-nova.mjs input.json [output-root] [source-vintage]');

const regionDefinitions = [
  { cityId: 'alexandria', regionId: 'alexandria-va', boundaryVersion: 'alexandria-va-boundary-v1', source: 'releases/alexandria-va/geography/boundary.geojson' },
  { cityId: 'arlington', regionId: 'arlington-va', boundaryVersion: 'arlington-va-boundary-v1', source: 'releases/arlington-va/geography/boundary.geojson' },
  { cityId: 'fairfax', regionId: 'fairfax-county-va', boundaryVersion: 'fairfax-county-va-boundary-v1', source: 'releases/fairfax-county-va/geography/boundary.geojson' },
  { cityId: 'falls-church', regionId: 'falls-church-va', boundaryVersion: 'falls-church-va-boundary-v1', source: 'releases/falls-church-va/geography/boundary.geojson' },
  { cityId: 'loudoun', regionId: 'loudoun-county-va', boundaryVersion: 'loudoun-county-va-boundary-v1', source: 'releases/loudoun-county-va/geography/boundary.geojson' },
  { cityId: 'vienna', regionId: 'vienna', boundaryVersion: 'vienna-city-envelope-v1', source: null }
];

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const raw = await readJson(path.resolve(inputPath));
const rows = raw.results || raw.records || raw;
if (!Array.isArray(rows)) throw new Error('Input must be a GBIF search envelope or array');

function geometryPredicate(geojson) {
  const feature = geojson.features?.[0] || geojson;
  if (!feature?.geometry) throw new Error('Boundary has no geometry');
  return (lat, lon) => booleanPointInPolygon(point([lon, lat]), feature);
}

const definitions = [];
for (const definition of regionDefinitions) {
  if (definition.source) {
    definition.contains = geometryPredicate(await readJson(path.resolve(root, definition.source)));
  } else {
    // Vienna has no checked-in boundary artifact yet. Replace this envelope
    // with reviewed geometry before a full Vienna release.
    definition.contains = (lat, lon) => lat >= 38.86 && lat <= 38.96 && lon >= -77.32 && lon <= -77.20;
  }
  definitions.push(definition);
}

const assignments = new Map(definitions.map((d) => [d.regionId, []]));
let unassigned = 0;
for (const row of rows) {
  const lat = Number(row.decimalLatitude);
  const lon = Number(row.decimalLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const matches = definitions.filter((d) => d.contains(lat, lon));
  if (matches.length) matches.forEach((region) => assignments.get(region.regionId).push(row));
  else unassigned++;
}

const sourceAccess = raw.retrieval?.access || 'GBIF occurrence search API';
const sourceQuery = raw.retrieval?.query || 'NOVA polygon; see acquisition envelope';
const report = { schemaVersion: 'biodiversity-nova-import-v1', generatedAt: new Date().toISOString(), sourceVintage, sourceAccess, sourceQuery, inputRows: rows.length, unassigned, regions: [] };

for (const definition of definitions) {
  const assigned = assignments.get(definition.regionId);
  const normalized = normalizeOccurrences(assigned, {
    regionId: definition.regionId,
    boundary: definition.contains,
    sourceVintage,
    boundaryVersion: definition.boundaryVersion,
    gbifDownloadDoi: null
  });
  normalized.metadata.fixture = false;
  normalized.metadata.sourceAccess = sourceAccess;
  normalized.metadata.sourceQuery = sourceQuery;
  normalized.metadata.inputRows = assigned.length;
  normalized.metadata.novaImport = true;
  const directory = path.resolve(outputRoot, definition.regionId, 'biodiversity');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'records.json'), JSON.stringify(normalized, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 'biodiversity-sidecar-v1',
    regionId: definition.regionId,
    label: definition.regionId,
    fixture: false,
    releaseStatus: 'candidate',
    sourceAccess,
    sourceQuery,
    boundaryVersion: definition.boundaryVersion,
    grid: { scheme: 'equirectangular-degree-grid', cellSizeDegrees: 0.01 },
    recordsUrl: './regions/' + definition.regionId + '/biodiversity/records.json',
    sourceVintage,
    gbifDownloadDoi: null,
    generatedAt: normalized.metadata.generatedAt,
    inputRows: assigned.length,
    aggregateRecords: normalized.records.length
  }, null, 2) + '\n');
  report.regions.push({ cityId: definition.cityId, regionId: definition.regionId, inputRows: assigned.length, aggregateRecords: normalized.records.length, occurrenceIds: new Set(normalized.records.flatMap((r) => r.source.occurrenceIds)).size, boundaryVersion: definition.boundaryVersion });
}

await fs.writeFile(path.resolve(outputRoot, 'biodiversity-import-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
