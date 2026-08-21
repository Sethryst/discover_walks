#!/usr/bin/env node
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultArtifactsRoot = path.join(projectRoot, 'federal-core', 'artifacts', 'nationwide-regions');
const defaultProgressFile = path.join(projectRoot, 'data', 'federal-region-poi-progress.json');

// These are the product POI packages that CITIES can load. Journeys are not
// POIs and are intentionally excluded from federal-region progress.
export const POI_SOURCE_FILES = [
  'data/vienna-poi.json', 'data/vienna-osm-poi.json', 'data/norfolk-poi.json', 'data/norfolk-osm-poi.json',
  'data/newyork-poi.json', 'data/newyork-osm-poi.json', 'regions/new-york-city/new-york-city-poi.json',
  'data/philadelphia-poi.json', 'data/philadelphia-osm-poi.json', 'regions/philadelphia/philadelphia-poi.json',
  'data/richmond-poi.json', 'data/richmond-osm-poi.json', 'regions/richmond/richmond-poi.json',
  'data/keystone-colorado-poi.json', 'regions/keystone-colorado/keystone-colorado-poi.json', 'data/pgcounty-poi.json',
  'regions/fairfax-county-va/pois.json', 'regions/alexandria-va/pois.json', 'regions/loudoun-county-va/pois.json',
  'data/dc-poi.json', 'regions/washington-dc/washington-dc-poi.json', 'data/sedona-arizona-poi.json',
  'regions/sedona-arizona/sedona-arizona-poi.json', 'data/boise-meridian-idaho-poi.json', 'regions/boise-meridian-idaho/boise-meridian-idaho-poi.json'
];

export async function tagPoiPackages({
  project = projectRoot, artifactsRoot = defaultArtifactsRoot, files = POI_SOURCE_FILES, progressFile = defaultProgressFile, write = true
} = {}) {
  const manifest = JSON.parse(await readFile(path.join(artifactsRoot, 'manifest.json'), 'utf8'));
  const congress = manifest.congressPolicy?.current;
  if (!Number.isInteger(congress)) throw new Error('Federal artifact manifest has no current Congress.');
  const resolver = await CanonicalFederalResolver.create({ artifactsRoot, congress });
  const regions = new Map(); let tagged = 0; let skipped = 0; const missingFiles = [];
  for (const relativeFile of files) {
    const filename = path.resolve(project, relativeFile);
    try { await stat(filename); } catch (error) { if (error.code === 'ENOENT') { missingFiles.push(relativeFile); continue; } throw error; }
    const document = JSON.parse(await readFile(filename, 'utf8'));
    const pois = poiList(document);
    let changed = false;
    for (const poi of pois) {
      if (!Number.isFinite(poi?.lat) || !Number.isFinite(poi?.lng) || !poi.id) { skipped += 1; continue; }
      const assignment = await resolver.resolve([poi.lng, poi.lat]);
      if (!assignment) throw new Error(`No canonical federal region matched ${poi.id} in ${relativeFile}.`);
      const next = { state: assignment.state, county: assignment.county, congressionalDistrict: assignment.congressionalDistrict, congress, boundaryVintage: assignment.boundaryVintage };
      if (JSON.stringify(poi.federalRegions) !== JSON.stringify(next)) { poi.federalRegions = next; changed = true; }
      for (const id of [next.state, next.county, next.congressionalDistrict]) addRegionPoi(regions, id, poi.id);
      tagged += 1;
    }
    if (write && changed) await writeJsonAtomic(filename, document);
  }
  const progress = {
    schemaVersion: 1, artifactType: 'federal-region-poi-progress', generatedAt: new Date().toISOString(),
    congress, boundaryVintage: resolver.boundaryVintage,
    regions: Object.fromEntries([...regions].sort(([a], [b]) => a.localeCompare(b)).map(([id, poiIds]) => [id, { total: poiIds.size, poiIds: [...poiIds].sort() }]))
  };
  if (write) await writeJsonAtomic(progressFile, progress);
  return { tagged, skipped, missingFiles, progress };
}

class CanonicalFederalResolver {
  static async create({ artifactsRoot, congress }) {
    const root = path.join(artifactsRoot, 'canonical');
    const stateFiles = await listStateFiles(path.join(root, 'base', 'states'));
    const states = (await Promise.all(stateFiles.map((fips) => readFeatures(path.join(root, 'base', 'states', fips, 'states.geojson'))))).flat();
    return new CanonicalFederalResolver({ root, congress, states });
  }
  constructor({ root, congress, states }) { this.root = root; this.congress = congress; this.states = states; this.byState = new Map(); this.boundaryVintage = null; }
  async resolve(point) {
    const state = findContaining(this.states, point); if (!state) return null;
    const fips = state.properties.stateFips;
    if (!this.byState.has(fips)) this.byState.set(fips, await this.loadState(fips));
    const layer = this.byState.get(fips);
    const county = findContaining(layer.counties, point);
    const district = findContaining(layer.districts, point);
    if (!county || !district) return null;
    this.boundaryVintage ||= district.properties.vintage;
    return { state: state.properties.boundary_id, county: county.properties.boundary_id, congressionalDistrict: district.properties.boundary_id, boundaryVintage: district.properties.vintage };
  }
  async loadState(fips) {
    const dir = path.join(this.root, 'base', 'states', fips);
    return { counties: await readFeatures(path.join(dir, 'counties.geojson')), districts: await readFeatures(path.join(this.root, 'congress', String(this.congress), 'states', fips, 'congressional-districts.geojson')) };
  }
}

async function listStateFiles(directory) {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name)).map((entry) => entry.name);
}
async function readFeatures(filename) { return (JSON.parse(await readFile(filename, 'utf8')).features || []); }
function poiList(document) { return document?.pois || document?.pointsOfInterest || []; }
function addRegionPoi(regions, id, poiId) { if (!regions.has(id)) regions.set(id, new Set()); regions.get(id).add(String(poiId)); }
function findContaining(features, point) { return features.find((feature) => inBbox(feature.properties?.bbox, point) && pointInGeometry(point, feature.geometry)); }
function inBbox([west, south, east, north] = [], [lng, lat]) { return west <= lng && lng <= east && south <= lat && lat <= north; }
function pointInGeometry([x, y], geometry) { const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []; return polygons.some(([outer, ...holes]) => pointInRing(x, y, outer) && !holes.some((ring) => pointInRing(x, y, ring))); }
function pointInRing(x, y, ring = []) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside; } return inside; }
async function writeJsonAtomic(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); const temp = `${filename}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, filename); }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) { const result = await tagPoiPackages(); console.log(`Tagged ${result.tagged} POIs; skipped ${result.skipped}; wrote ${Object.keys(result.progress.regions).length} region progress records.${result.missingFiles.length ? ` Optional packages absent: ${result.missingFiles.join(', ')}.` : ''}`); }
