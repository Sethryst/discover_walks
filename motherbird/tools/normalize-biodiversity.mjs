import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MAX_UNCERTAINTY_METERS = 1000;
export function normalizeOccurrences(rows, { regionId, boundary, maxUncertaintyMeters = DEFAULT_MAX_UNCERTAINTY_METERS, sourceVintage = new Date().toISOString().slice(0, 10), boundaryVersion = 'unspecified', gbifDownloadDoi = null } = {}) {
  const grouped = new Map();
  for (const row of rows) {
    const lat = Number(row.decimalLatitude), lon = Number(row.decimalLongitude), uncertainty = Number(row.coordinateUncertaintyInMeters ?? row.coordinateUncertainty ?? Infinity);
    if (!regionId || row.regionId && row.regionId !== regionId || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(uncertainty) || uncertainty > maxUncertaintyMeters || row.occurrenceStatus === 'absent') continue;
    if (row.establishmentMeans && ['captive','cultivated','managed'].includes(String(row.establishmentMeans).toLowerCase())) continue;
    if (row.captive === true || row.cultivated === true) continue;
    if (boundary && !boundary(lat, lon)) continue;
    const month = Number(row.month || String(row.eventDate || '').slice(5, 7)); if (month < 1 || month > 12) continue;
    const cell = row.gridCellId || `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;
    const taxonId = String(row.taxonID ?? row.taxonId ?? row.scientificName ?? row.species ?? 'unknown'); const key = `${cell}|${taxonId}|${month}`;
    const item = grouped.get(key) || { recordId: `aggregate-${cell}-${taxonId}-${month}`, taxonId, scientificName: row.scientificName || row.species || 'Unknown taxon', commonName: row.vernacularName || null, kingdom: row.kingdom || null, class: row.class || null, order: row.order || null, family: row.family || null, genus: row.genus || null, species: row.species || null, regionId, gridCellId: cell, month, observationCount: 0, coordinateUncertainty: { summaryMeters: 0, privacyClass: 'public' }, source: { provider: row.datasetName || 'GBIF/iNaturalist Research-grade Observations', occurrenceIds: [], researchGrade: row.qualityGrade === 'research' || row.researchGrade === true, captiveOrCultivatedExcluded: true, gbifDownloadDoi }, representativeImage: row.mediaUrl && row.mediaLicense ? { url: row.mediaUrl, license: row.mediaLicense } : null, generatedAt: new Date().toISOString(), sourceVintage, boundaryVersion };
    item.observationCount++; item.coordinateUncertainty.summaryMeters = Math.max(item.coordinateUncertainty.summaryMeters, uncertainty); if (row.occurrenceID) item.source.occurrenceIds.push(String(row.occurrenceID));
    if (row.geoprivacy === 'obscured' || row.sensitive === true || row.coordinateUncertaintyInMeters > 1000) item.coordinateUncertainty.privacyClass = 'obscured';
    grouped.set(key, item);
  }
  return { schemaVersion: 'biodiversity-sidecar-v1', metadata: { regionId, sourceVintage, boundaryVersion, gbifDownloadDoi, generatedAt: new Date().toISOString() }, records: [...grouped.values()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [input, output, regionId] = process.argv.slice(2); if (!input || !output || !regionId) throw new Error('Usage: node normalize-biodiversity.mjs input.json output.json region-id');
  const rows = JSON.parse(await fs.readFile(input, 'utf8')); const result = normalizeOccurrences(rows.records || rows, { regionId }); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
}
