import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cityId = process.argv[2] || 'vienna';
const city = CITIES[cityId];
if (!city) throw new Error(`Unknown city '${cityId}'. Use a key from js/constants.js.`);
const output = resolve(root, 'data', `${cityId}-osm-poi.json`);
const center = city.center;
const radiusMeters = cityId === 'newyork' ? 3500 : 5500;
const query = `[out:json][timeout:45];(nwr(around:${radiusMeters},${center.lat},${center.lng})[amenity=cafe];nwr(around:${radiusMeters},${center.lat},${center.lng})[amenity=library];nwr(around:${radiusMeters},${center.lat},${center.lng})[leisure=park];nwr(around:${radiusMeters},${center.lat},${center.lng})[leisure=garden];);out center tags;`;
const categoryFor = (tags) => tags.amenity === 'cafe' ? 'coffee' : tags.amenity === 'library' ? 'library' : tags.leisure === 'park' ? 'park' : 'nature';
const coordinateFor = (element) => element.type === 'node' ? [element.lat, element.lon] : [element.center?.lat, element.center?.lon];
const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let payload;
let lastError;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'MotherBird-OSM-supplement/1.0' }, body: new URLSearchParams({ data: query }) });
    if (!response.ok) { lastError = new Error(`${endpoint} returned ${response.status}`); continue; }
    payload = await response.json();
    break;
  } catch (error) { lastError = error; }
}
if (!payload) throw lastError || new Error('No Overpass endpoint returned data');
const seen = new Set();
const candidates = (payload.elements || []).map((element) => {
  const [lat, lng] = coordinateFor(element);
  const tags = element.tags || {};
  const category = categoryFor(tags);
  return { id: `osm-${cityId}-${element.type}-${element.id}`, name: tags.name || `${category} near ${city.name}`, lat, lng, category, tags: [category, 'osm'], description: tags.description || null, hours: tags.opening_hours || null, accessibility: tags.wheelchair || null, website: tags.website || null, source: { name: 'OpenStreetMap contributors', url: `https://www.openstreetmap.org/${element.type}/${element.id}` }, sourceType: 'osm_overpass', unverified: false };
}).filter((poi) => poi.name && Number.isFinite(poi.lat) && Number.isFinite(poi.lng) && !seen.has(poi.id) && seen.add(poi.id)).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
const limitPerCategory = 300;
const counts = new Map();
const pois = candidates.filter((poi) => { const count = counts.get(poi.category) || 0; if (count >= limitPerCategory) return false; counts.set(poi.category, count + 1); return true; });
await writeFile(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), regionId: cityId, source: { provider: 'OpenStreetMap Overpass', license: 'ODbL', queryRadiusMeters: radiusMeters, limitPerCategory }, pois }, null, 2) + '\n');
console.log(`Wrote ${pois.length} ${city.name} OSM places to ${output}`);
