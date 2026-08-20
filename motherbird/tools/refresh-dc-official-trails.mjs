/**
 * Builds browser-safe route geometry from the public DDOT bike-trails layer.
 * No line is invented: each exported coordinate comes directly from a named,
 * maintained FeatureServer record in WGS84.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'data', 'dc-official-trails.js');
const layer = 'https://services.arcgis.com/neT9SoYxizqTHZPH/ArcGIS/rest/services/MBT_Map_Draft_WFL1/FeatureServer/15/query';
const records = [{
  id: 'dc-anacostia-river-trail-east-bank',
  objectId: 55,
  title: 'Anacostia River Trail: East Bank',
  // These are orientation labels, not invented trail names. The city GIS
  // publishes the corridor as one feature, so a walker gets manageable
  // source-preserving sections instead of one overwhelming eight-mile card.
  sectionLabels: ['Fort Dupont edge', 'Fairlawn bend', 'Anacostia Recreation', 'Historic Anacostia', 'Poplar Point', '11th Street Bridge', 'Navy Yard approach', 'Yards Park edge'],
  description: 'A source-mapped East Bank corridor. Verify access and any closures before heading out.',
  category: 'waterfront'
}];

const EARTH_RADIUS_METERS = 6371008.8;
function distanceMeters([lat1, lng1], [lat2, lng2]) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function interpolate(a, b, fraction) { return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]; }

function splitIntoWalkSections(coordinates, count) {
  const total = coordinates.slice(1).reduce((sum, point, index) => sum + distanceMeters(coordinates[index], point), 0);
  const target = total / count;
  const sections = [];
  let section = [coordinates[0]], accumulated = 0, boundary = target;
  for (let index = 1; index < coordinates.length; index += 1) {
    let start = coordinates[index - 1], end = coordinates[index], remaining = distanceMeters(start, end);
    while (sections.length < count - 1 && accumulated + remaining >= boundary) {
      const cut = interpolate(start, end, (boundary - accumulated) / remaining);
      section.push(cut);
      sections.push(section);
      section = [cut];
      start = cut;
      remaining = distanceMeters(start, end);
      accumulated = boundary;
      boundary += target;
    }
    section.push(end);
    accumulated += remaining;
  }
  sections.push(section);
  return sections;
}

async function fetchRecord(record) {
  const url = new URL(layer);
  url.search = new URLSearchParams({
    where: `OBJECTID=${record.objectId}`,
    outFields: 'OBJECTID,NAME,TRAIL_SEGMENT,SEGMENT_LENGTH,MAINTENANCE,SURFACE_TYPE,USE_TYPE,EDIT_DATE',
    returnGeometry: 'true', outSR: '4326', f: 'json'
  });
  const response = await fetch(url, { headers: { 'User-Agent': 'DiscoverWalks/1.0' } });
  if (!response.ok) throw new Error(`DC GIS returned ${response.status} for ${record.id}`);
  const payload = await response.json();
  const feature = payload.features?.[0];
  const pathCoordinates = feature?.geometry?.paths?.flat();
  if (!feature || !Array.isArray(pathCoordinates) || pathCoordinates.length < 2) throw new Error(`DC GIS did not return usable geometry for ${record.id}`);
  const coordinates = pathCoordinates.map(([lng, lat]) => [lat, lng]);
  if (!coordinates.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error(`DC GIS returned invalid WGS84 coordinates for ${record.id}`);
  const meters = Number(feature.attributes.SEGMENT_LENGTH);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error(`DC GIS returned no usable length for ${record.id}`);
  const sections = splitIntoWalkSections(coordinates, record.sectionLabels.length);
  return sections.map((section, index) => {
    const sectionMeters = section.slice(1).reduce((sum, point, pointIndex) => sum + distanceMeters(section[pointIndex], point), 0);
    return {
      id: `${record.id}-section-${index + 1}`, city: 'dc', title: `Anacostia River Trail · ${record.sectionLabels[index]}`,
      distanceMiles: Number((sectionMeters / 1609.344).toFixed(1)),
      durationMinutes: Math.round(sectionMeters / 80), difficulty: 'Easy', category: record.category,
      description: `${record.description} Short source-preserving stretch ${index + 1} of ${sections.length}; near ${record.sectionLabels[index]}.`,
      sourceName: 'DDOT Bike Trails (DC) GIS', sourceUrl: layer.replace('/query', ''),
      geometryStatus: 'validated',
      geometryProvenance: { type: 'official-gis', featureName: `${feature.attributes.NAME.trim()} — ${feature.attributes.TRAIL_SEGMENT}`, sourceRecordId: String(feature.attributes.OBJECTID), retrievedAt: new Date().toISOString().slice(0, 10), method: 'equal-distance source-feature section' },
      maintenance: feature.attributes.MAINTENANCE || null, surface: feature.attributes.SURFACE_TYPE || null, use: feature.attributes.USE_TYPE || null,
      collection: record.title, sectionNumber: index + 1, sectionCount: sections.length, coordinates: section
    };
  });
}

const routes = (await Promise.all(records.map(fetchRecord))).flat();
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `// Generated by tools/refresh-dc-official-trails.mjs. Do not hand-edit geometry.\nexport const DC_OFFICIAL_TRAILS = ${JSON.stringify(routes, null, 2)};\n`, 'utf8');
console.log(`Wrote ${routes.length} official DC trail route(s) to ${output}`);
