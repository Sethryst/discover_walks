#!/usr/bin/env node
/** Convert approved cached OSM snapshots into the shared offline runtime contract. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(root, '..');
const snapshots = {
  norfolk: 'data/osm/norfolk-osm-poi.json',
  nyc: 'data/osm/newyork-osm-poi.json',
  philadelphia: 'data/osm/philadelphia-osm-poi.json',
  richmond: 'data/osm/richmond-osm-poi.json',
  'wolf-trap-va': 'data/osm/wolf-trap-va-poi.json'
};
const selected = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('-')));
const generatedAtOverride = process.argv.find((arg) => arg.startsWith('--generated-at='))?.split('=')[1];

for (const [regionId, relative] of Object.entries(snapshots)) {
  if (selected.size && !selected.has(regionId)) continue;
  const config = JSON.parse(await readFile(path.join(projectRoot, 'app', 'regions', `${regionId}.json`), 'utf8'));
  const snapshot = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
  const sourceVintage = snapshot.generatedAt || generatedAtOverride || '1970-01-01T00:00:00.000Z';
  const generatedAt = generatedAtOverride || sourceVintage;
  const input = snapshot.pois || snapshot.pointsOfInterest || [];
  const warnings = [];
  const chosen = new Map();
  for (const raw of input) {
    const normalized = normalize(raw, config.bbox, config.osm.sourceId, sourceVintage);
    if (!normalized) {
      warnings.push({ code: 'unusable_source_record', source: config.osm.sourceId, detail: `${raw.id || 'unknown'} lacks a deterministic OSM identity, usable name, or in-bounds coordinates.` });
      continue;
    }
    if (chosen.has(normalized.id)) {
      warnings.push({ code: 'duplicate_osm_id', source: config.osm.sourceId, detail: `${normalized.id} appeared more than once; the stable first record was retained.` });
      continue;
    }
    chosen.set(normalized.id, normalized);
  }
  const pois = [...chosen.values()].sort((a, b) => a.id.localeCompare(b.id));
  const counts = Object.fromEntries([...new Set(pois.map((poi) => poi.category))].sort().map((category) => [category, pois.filter((poi) => poi.category === category).length]));
  const envelope = { schemaVersion: 1, regionId, generatedAt, sourceVintage, sourceConfigurationId: config.osm.sourceId, attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', pois };
  const validation = { schemaVersion: 1, regionId, generatedAt, accepted: pois.length, rejected: warnings.length, warnings };
  const spatial = { schemaVersion: 1, regionId, generatedAt, sourceConfigurationId: config.osm.sourceId, records: pois.map(({ id, lat, lng, category }) => ({ id, lat, lng, category })) };
  const output = path.join(root, 'regions', regionId, 'osm');
  await mkdir(output, { recursive: true });
  const artifacts = { 'pois.json': bytes(envelope), 'validation.json': bytes(validation), 'spatial-index-delta.json': bytes(spatial), 'attribution.json': bytes({ attribution: envelope.attribution, license: envelope.license, licenseUrl: envelope.licenseUrl }) };
  const manifest = {
    schemaVersion: 1, regionId, generatedAt, sourceVintage, sourceConfigurationId: config.osm.sourceId,
    source: { name: 'OpenStreetMap', url: config.osm.endpoint, attribution: envelope.attribution, license: envelope.license, licenseUrl: envelope.licenseUrl },
    recordCountsByCategory: counts,
    artifacts: Object.keys(artifacts),
    checksums: Object.fromEntries(Object.entries(artifacts).map(([name, value]) => [name, `sha256:${createHash('sha256').update(value).digest('hex')}`]))
  };
  for (const [name, value] of Object.entries(artifacts)) await writeFile(path.join(output, name), value);
  await writeFile(path.join(output, 'manifest.json'), bytes(manifest));
  console.log(`${regionId}: ${pois.length} OSM places`);
}

function normalize(raw, bbox, sourceConfigurationId, retrievedAt) {
  const match = String(raw.id || '').match(/(?:^|[-:])(node|way|relation)[-:](\d+)$/);
  if (!match || !raw.name?.trim() || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
  const [south, west, north, east] = bbox;
  if (raw.lat < south || raw.lat > north || raw.lng < west || raw.lng > east) return null;
  const [, elementType, elementId] = match;
  const observableTags = {};
  if (raw.hours) observableTags.opening_hours = raw.hours;
  if (raw.accessibility) observableTags.wheelchair = raw.accessibility;
  return {
    id: `osm:${elementType}:${elementId}`, name: raw.name.trim(), lat: raw.lat, lng: raw.lng,
    category: raw.category || 'community', tags: [...new Set([...(raw.tags || []), raw.category, 'osm'].filter(Boolean))],
    description: raw.description || undefined, website: raw.website || undefined,
    fromOsm: true, sourceType: 'osm_overpass', osmElementType: elementType, osmElementId: elementId,
    osmTags: observableTags,
    source: [{ name: 'OpenStreetMap', id: sourceConfigurationId, elementId, url: `https://www.openstreetmap.org/${elementType}/${elementId}`, attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', retrievedAt }]
  };
}

function bytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
